// 本地中译英（Opus-MT zh→en，ONNX 量化版，纯 CPU，不联网）
//
// 为什么要有这一层：文章文件名必须是英文（URL 会用到中文会变百分号编码），
// 而标题是中文。原来的做法是一张手工维护的词表，没收录的词就翻不出来 ——
// 结果整章课程笔记批量入库时六篇全叫 post-2026-11-06。
//
// 现在换成模型：任意中文都能翻。模型是 Helsinki-NLP 的 Opus-MT（7800 万参数），
// 专门做中英翻译，在 6 亿参数以下的模型里实测质量最好（FLORES-200 中译英 23.0 分，
// 高于 Qwen2.5-0.5B 的 18.1）。量化后磁盘 285 MB。
//
// 关键设计：模型**不常驻**。加载要 1.3 秒、占约 900 MB 内存，
// 而实际只有入库那几秒用得上。所以每次翻译起一个子进程，翻完就退，
// 内存全部还给系统，管家平时一点不占。
//
// 另外有结果缓存 slug-cache.json：同一个标题只翻一次，
// 也保证「设计概念」这篇叫 design-concepts，下篇不会变成 designing-concept。

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANAGER_ROOT = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(MANAGER_ROOT, 'slug-cache.json');
const MODEL_DIR = path.join(MANAGER_ROOT, 'models');

// q4 是这几个量化档里质量最好的（int8 会把内容翻丢，实测「体系结构设计」只剩 Chapter 6）
const DTYPE = 'q4';

// 首次没模型时要联网下 285 MB，给足时间；之后纯本地 3 秒内出结果
const TIMEOUT_MS = 180000;

let cache = null;
let cacheDirty = false;
// 攒一小会儿再翻：同一批拖进来的几篇几乎同时问，合并成一次子进程调用，
// 不然六篇就是六次「起进程 + 加载 1.3 秒」
let pendingTitles = new Set();
let pendingPromise = null;

async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
    if (!cache || typeof cache !== 'object') cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

async function saveCache() {
  if (!cacheDirty || !cache) return;
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    cacheDirty = false;
  } catch {
    /* 缓存写不进去不影响主流程 */
  }
}

/** 模型是否已经下到本地 */
async function hasModel() {
  try {
    const f = path.join(MODEL_DIR, 'onnx-community', 'opus-mt-zh-en', 'onnx', 'encoder_model_q4.onnx');
    const st = await fs.stat(f);
    return st.size > 1024 * 1024;
  } catch {
    return false;
  }
}

/** 起子进程跑一批标题，返回 { 原文: 译文 } */
function runWorker(titles, { allowDownload = false } = {}) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'translate-worker.mjs');
    const child = spawn(process.execPath, [workerPath], {
      cwd: MANAGER_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 首次允许从镜像下载，之后强制离线
        HF_ALLOW_REMOTE: allowDownload ? '1' : '0',
        HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
      },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('翻译超时'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      // stdout 理论上只有一个 JSON，但从最后一个 { 开始截更保险
      const start = stdout.lastIndexOf('{"ok"');
      const text = start >= 0 ? stdout.slice(start) : stdout;
      try {
        const parsed = JSON.parse(text);
        if (!parsed.ok) return reject(new Error(parsed.error || '翻译失败'));
        resolve(parsed.out || {});
      } catch {
        reject(new Error(`翻译进程没有返回结果${stderr ? '：' + stderr.split('\n').filter(Boolean).slice(-1)[0] : ''}`));
      }
    });

    child.stdin.write(JSON.stringify({ titles, dtype: DTYPE, allowDownload }));
    child.stdin.end();
  });
}

/** 把攒下的标题一次性翻掉，结果写进缓存 */
async function flushPending() {
  const batch = [...pendingTitles];
  pendingTitles = new Set();
  if (batch.length === 0) return;

  const downloaded = await hasModel();
  const out = await runWorker(batch, { allowDownload: !downloaded });

  const c = await loadCache();
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v) {
      c[k] = v;
      cacheDirty = true;
    }
  }
  await saveCache();
}

/**
 * 批量翻译标题。命中缓存的不会再跑模型。
 *
 * @param {string[]} titles 中文标题
 * @returns {Promise<Record<string,string>>} 原文 → 英文（失败的标题不会出现在结果里）
 */
export async function translateTitles(titles) {
  const list = [...new Set((titles || []).filter((t) => typeof t === 'string' && t.trim()))];
  if (list.length === 0) return {};

  const c = await loadCache();
  const result = {};
  const todo = [];

  for (const t of list) {
    if (typeof c[t] === 'string' && c[t]) result[t] = c[t];
    else todo.push(t);
  }

  if (todo.length === 0) return result;

  for (const t of todo) pendingTitles.add(t);

  if (!pendingPromise) {
    pendingPromise = (async () => {
      // 80 毫秒的收集窗口：等同一批的其它请求把标题塞进来
      await new Promise((r) => setTimeout(r, 80));
      try {
        await flushPending();
      } catch (e) {
        // 模型不可用不该挡住入库 —— 上层会退回词表/按日期起名
        console.warn('[translate] 本地翻译不可用：' + (e && e.message ? e.message : e));
        pendingTitles.clear();
      } finally {
        pendingPromise = null;
      }
    })();
  }

  await pendingPromise;

  for (const t of list) if (typeof c[t] === 'string' && c[t]) result[t] = c[t];
  return result;
}

/** 解析结果里挑一个：给个标题，拿英文（拿不到返回空串） */
export async function translateOne(title) {
  const map = await translateTitles([title]);
  return map[title] || '';
}

export const modelDir = MODEL_DIR;
