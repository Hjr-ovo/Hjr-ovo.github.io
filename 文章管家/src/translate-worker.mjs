// 翻译子进程：读 stdin 的标题数组 → 翻译 → 写 stdout JSON → 退出
//
// 为什么单独起进程而不是在管家主进程里加载模型：
//   Opus-MT 的 q4 权重加载后 ONNX Runtime 会在内存里展开到约 900 MB。
//   常驻的话管家一直占着这 900 MB，而实际用到它只有入库那两三秒。
//
//   实测（2026-11-06）：加载 1.3 s，翻一句 60–200 ms。
//   所以「起进程 → 翻译 → 退出」总共 2–4 秒，完事内存 100% 还给系统。
//
// 协议：stdin 收 { titles: string[], dtype?: string }
//       stdout 收 { ok: true, out: { 原文: 译文 } } 或 { ok: false, error }
// 日志一律走 stderr，stdout 只留 JSON（否则解析会被 warning 打断）

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_ROOT = path.resolve(__dirname, '../models');

// 每个标题最多生成多少 token。slug 只要三五个词，
// 不设上限的话模型会一直吐到 512，白费时间也白占内存
const MAX_NEW_TOKENS = 32;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw || '{}');
  const titles = Array.isArray(input.titles) ? input.titles.filter((t) => typeof t === 'string' && t) : [];

  if (titles.length === 0) {
    process.stdout.write(JSON.stringify({ ok: true, out: {} }));
    process.exit(0);
  }

  const { pipeline, env } = await import('@huggingface/transformers');

  // 默认只认本地已下好的模型，运行期不联网。
  // 只有第一次（本地还没有模型）才允许从镜像拉一次，见 translate.mjs 的 hasModel()
  env.cacheDir = MODEL_ROOT;
  env.allowLocalModels = true;
  env.allowRemoteModels = input.allowDownload === true;
  env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com';

  const pipe = await pipeline('translation', 'onnx-community/opus-mt-zh-en', {
    dtype: input.dtype || 'q4',
    progress_callback: null,
  });

  const out = {};
  for (const t of titles) {
    const r = await pipe(t, { max_new_tokens: MAX_NEW_TOKENS });
    const text = Array.isArray(r) ? r[0]?.translation_text : r?.translation_text;
    if (typeof text === 'string') out[t] = text;
  }

  process.stdout.write(JSON.stringify({ ok: true, out }));
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
