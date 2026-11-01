// 文章读写：全部走磁盘，不缓存
//
// 设计文档第六节：每次操作前重新读盘。文件在工具外被改过时以磁盘为准并提示冲突。
// 唯一允许写的目录是 site/src/content/posts/，站点其它文件一概不碰。

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseDocument, patchMeta, replaceBody, validateMeta, today } from './fm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../..');
export const SITE_DIR = path.join(ROOT, 'site');
export const POSTS_DIR = path.join(SITE_DIR, 'src', 'content', 'posts');
// 回收箱放在**站点之外**（文章管家目录下）。
// 这样 Astro 的内容集合根本扫不到它，删掉的文章在网站上自然消失，
// 也不会进 PageFind 索引 —— 不需要在构建时再写任何排除逻辑。
export const TRASH_DIR = path.resolve(__dirname, '../回收箱');

// ---------- 统计（对齐 site/src/utils/reading-time.ts） ----------

export function readingStats(body) {
  let codeLines = 0;
  const noCode = body.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, inner) => {
    codeLines += inner.split('\n').filter((l) => l.trim() !== '').length;
    return ' ';
  });

  const plain = noCode
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');

  const han = (plain.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const en = (plain.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) || []).length;

  const minutes = han / 350 + en / 200 + codeLines / 50;
  return {
    chars: han + en,
    codeLines,
    minutes: Math.max(1, Math.round(minutes)),
  };
}

// ---------- 工具 ----------

function sha1(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

function asDateString(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function safeSlug(slug) {
  if (typeof slug !== 'string' || slug === '') throw new Error('文件名不能为空');
  if (/[\\/:*?"<>|]/.test(slug) || slug.includes('..') || /[\x00-\x1f]/.test(slug)) {
    throw new Error('文件名里有非法字符');
  }
  return slug;
}

function fileOf(slug) {
  return path.join(POSTS_DIR, `${safeSlug(slug)}.md`);
}

/**
 * 原子写：先写 .tmp 再 rename。
 *
 * ⚠️ Windows 上 rename 偶尔会报 EPERM —— 站点 dev 的 watcher 正好在读这个文件时
 * 就会锁住一瞬间（2026-11-01 实测踩到）。所以失败后重试几次，
 * 而不是直接把 EPERM 抛给用户看。
 */
export async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      if (i === 4) throw err;
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }
}

// ---------- 读 ----------

/** 列表：每次调用都重新读磁盘 */
export async function listPosts() {
  let names = [];
  try {
    names = await fs.readdir(POSTS_DIR);
  } catch {
    return { posts: [], dirMissing: true };
  }

  const files = names.filter((n) => n.endsWith('.md')).sort();
  const posts = [];

  for (const name of files) {
    const slug = name.slice(0, -3);
    const full = path.join(POSTS_DIR, name);
    const stat = await fs.stat(full);
    const raw = await fs.readFile(full, 'utf8');

    const item = { slug, mtimeMs: stat.mtimeMs, size: stat.size };
    try {
      const { data, body } = parseDocument(raw);
      const stats = readingStats(body);
      const cats = data.categories;
      item.title = String(data.title ?? '').trim() || `（无标题）${slug}`;
      item.description = String(data.description ?? data.explain ?? '');
      item.pubDate = asDateString(data.pubDate ?? data.date ?? data.created);
      item.updatedDate = asDateString(data.updatedDate);
      item.categories = Array.isArray(cats) ? cats : cats ? [String(cats)] : [];
      item.tags = Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [];
      item.draft = data.draft === true;
      item.chars = stats.chars;
      item.minutes = stats.minutes;
      item.broken = null;
    } catch (err) {
      item.title = `（无法解析）${slug}`;
      item.broken = err.message;
      item.description = '';
      item.pubDate = '';
      item.categories = [];
      item.tags = [];
      item.draft = false;
      item.chars = 0;
      item.minutes = 0;
    }
    posts.push(item);
  }

  posts.sort((a, b) => (a.pubDate < b.pubDate ? 1 : a.pubDate > b.pubDate ? -1 : 0));
  return { posts, dirMissing: false };
}

/** 单篇：返回 { slug, raw, data, body, hash, mtimeMs } */
export async function readPost(slug) {
  const full = fileOf(slug);
  let raw;
  try {
    raw = await fs.readFile(full, 'utf8');
  } catch {
    throw Object.assign(new Error(`找不到文章：${slug}`), { code: 'NOT_FOUND' });
  }
  const stat = await fs.stat(full);
  const parsed = parseDocument(raw);
  return {
    slug,
    raw,
    data: parsed.data,
    body: parsed.body,
    hash: sha1(raw),
    mtimeMs: stat.mtimeMs,
  };
}

// ---------- 写 ----------

/**
 * 保存一篇文章。
 *
 * @param {string} slug
 * @param {{ meta: object, body?: string, baseHash?: string }} payload
 */
export async function savePost(slug, payload) {
  const full = fileOf(slug);
  const current = await readPost(slug);

  // 冲突检测：文件在工具外被改过就停下，绝不静默覆盖
  if (payload.baseHash && payload.baseHash !== current.hash) {
    throw Object.assign(
      new Error('磁盘上的文件比工具里打开时的版本新，可能刚在别的编辑器里改过'),
      { code: 'CONFLICT' },
    );
  }

  const meta = { ...payload.meta };
  if (!meta.updatedDate) delete meta.updatedDate;
  const problems = validateMeta(meta);
  if (problems.length > 0) {
    throw Object.assign(new Error(problems.join('；')), { code: 'INVALID', problems });
  }

  // 1) frontmatter 最小改动
  const { content: afterMeta, changedKeys } = patchMeta(current.raw, {
    title: String(meta.title).trim(),
    description: String(meta.description).trim(),
    pubDate: String(meta.pubDate).trim(),
    ...(meta.updatedDate ? { updatedDate: String(meta.updatedDate).trim() } : {}),
    categories: (meta.categories || []).map((s) => String(s).trim()).filter(Boolean),
    tags: (meta.tags || []).map((s) => String(s).trim()).filter(Boolean),
    draft: meta.draft === true,
  });

  // 2) 正文：只有真的改了才替换（不改就保持逐字节原样）
  const before = parseDocument(afterMeta);
  let finalText = afterMeta;
  const bodyChanged = typeof payload.body === 'string' && payload.body !== before.body;
  if (bodyChanged) finalText = replaceBody(afterMeta, payload.body);

  if (!bodyChanged && changedKeys.length === 0) {
    return { saved: false, changed: [], slug, hash: current.hash };
  }

  // 3) 原子写：先写 .tmp 再 rename，中途失败不留半截文件
  await writeAtomic(full, finalText);

  return {
    saved: true,
    changed: changedKeys,
    bodyChanged,
    slug,
    hash: sha1(finalText),
  };
}

// ---------- 分类 / 标签 ----------

/**
 * 给一篇文章增删**单个**标签或分类（界面里拖拽用）。
 *
 * 走的是和保存同一条 patchMeta 通道，所以同样只改那一行，
 * 正文一个字节都不动。已经有的就返回 changed:false，不写文件。
 *
 * @param {string} slug
 * @param {'tags'|'categories'} kind
 * @param {string} name
 * @param {'add'|'remove'} action
 */
export async function updateTerms(slug, kind, name, action) {
  const key = kind === 'categories' ? 'categories' : kind === 'tags' ? 'tags' : null;
  if (!key) throw Object.assign(new Error('只能是 tags 或 categories'), { code: 'INVALID' });

  const term = String(name ?? '').trim();
  if (!term) throw Object.assign(new Error('名称不能为空'), { code: 'INVALID' });
  if (action !== 'add' && action !== 'remove') {
    throw Object.assign(new Error('动作只能是 add 或 remove'), { code: 'INVALID' });
  }

  const current = await readPost(slug);
  const raw = current.data[key];
  const list = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];

  let next;
  if (action === 'add') {
    if (list.includes(term)) return { changed: false, kind: key, terms: list, slug };
    next = [...list, term];
  } else {
    next = list.filter((x) => x !== term);
    if (next.length === list.length) return { changed: false, kind: key, terms: list, slug };
    // 分类现在允许清空（2026-11-01）：一篇文章可以不属于任何分类。
  }

  const { content, changedKeys } = patchMeta(current.raw, { [key]: next });
  if (changedKeys.length === 0) return { changed: false, kind: key, terms: next, slug };

  await writeAtomic(fileOf(slug), content);

  return { changed: true, kind: key, terms: next, slug };
}

export async function taxonomy() {
  const { posts } = await listPosts();
  const catMap = new Map();
  const tagMap = new Map();

  for (const p of posts) {
    for (const c of p.categories) catMap.set(c, (catMap.get(c) || 0) + 1);
    for (const t of p.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  }

  const toArr = (m) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));

  return { categories: toArr(catMap), tags: toArr(tagMap), today: today() };
}

/** 文件名是否被占用（站内 + 回收箱，都用同一个名字会互相顶） */
export async function slugExists(slug) {
  for (const dir of [POSTS_DIR, TRASH_DIR]) {
    try {
      await fs.access(path.join(dir, `${slug}.md`));
      return true;
    } catch {
      /* 这个目录里没有，继续看下一个 */
    }
  }
  return false;
}

/**
 * 给一个想用的文件名找一个**没被占用**的版本。
 *
 * 用户要求：文件名自动从文章名来，出现两篇一样的要「自动处理」——
 * 所以这里不报错，直接加序号：`two-sum` → `two-sum-2` → `two-sum-3`。
 * 回收箱里的名字也算占用，否则恢复时会撞车。
 */
export async function uniqueSlug(base) {
  const clean = String(base || '').trim() || 'post';
  if (!(await slugExists(clean))) return clean;
  for (let n = 2; n < 1000; n++) {
    const cand = `${clean}-${n}`;
    if (!(await slugExists(cand))) return cand;
  }
  throw Object.assign(new Error(`「${clean}」这个名字的变体用完了，换个名字`), { code: 'EXISTS' });
}

// ---------- 回收箱 ----------
//
// 两级删除（2026-11-01 用户要求）：
//   第一次删 → 文件移到 文章管家/回收箱/，站上立刻消失，可以恢复
//   回收箱里再删 → 交给 Windows 回收站（不是不可逆的 rm）
// 「恢复」时如果站里已经有同名文章，自动加序号，不覆盖。

async function ensureTrash() {
  await fs.mkdir(TRASH_DIR, { recursive: true });
}

/** 把一篇文章移进回收箱 */
export async function moveToTrash(slug) {
  const from = fileOf(slug);
  try {
    await fs.access(from);
  } catch {
    throw Object.assign(new Error(`找不到文章：${slug}`), { code: 'NOT_FOUND' });
  }
  await ensureTrash();
  const to = path.join(TRASH_DIR, `${slug}.md`);

  // 回收箱里同名（理论上不会，因为 slugExists 也查回收箱）—— 保险起见换名
  let target = to;
  if (await exists(target)) target = path.join(TRASH_DIR, `${await uniqueSlug(slug)}.md`);

  await fs.rename(from, target);
  return { slug, trashedAs: path.basename(target, '.md') };
}

/** 回收箱列表（按删除时间倒序；删除时间就用文件 mtime） */
export async function listTrash() {
  let names = [];
  try {
    names = await fs.readdir(TRASH_DIR);
  } catch {
    return { items: [] }; // 目录还不存在 = 空的
  }

  const items = [];
  for (const name of names.filter((n) => n.endsWith('.md'))) {
    const slug = name.slice(0, -3);
    const full = path.join(TRASH_DIR, name);
    const stat = await fs.stat(full);
    const raw = await fs.readFile(full, 'utf8');
    const item = { slug, deletedAt: stat.mtime.toISOString(), size: stat.size, title: slug, pubDate: '', categories: [], tags: [] };
    try {
      const { data, body } = parseDocument(raw);
      item.title = String(data.title ?? '').trim() || slug;
      item.pubDate = asDateString(data.pubDate ?? data.date ?? data.created);
      item.categories = Array.isArray(data.categories) ? data.categories.map(String) : data.categories ? [String(data.categories)] : [];
      item.tags = Array.isArray(data.tags) ? data.tags.map(String) : data.tags ? [String(data.tags)] : [];
      item.chars = readingStats(body).chars;
    } catch {
      item.broken = true;
    }
    items.push(item);
  }

  items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  return { items };
}

/** 在「站内」找一个没被占用的名字（恢复时用 —— 它自己还在回收箱里，不能算占用） */
async function freeNameInPosts(base) {
  if (!(await exists(path.join(POSTS_DIR, `${base}.md`)))) return base;
  for (let n = 2; n < 1000; n++) {
    const cand = `${base}-${n}`;
    if (!(await exists(path.join(POSTS_DIR, `${cand}.md`)))) return cand;
  }
  throw Object.assign(new Error(`「${base}」的名字用完了，换个名字再恢复`), { code: 'EXISTS' });
}

/** 从回收箱恢复。站里已有同名就自动加序号，绝不覆盖现有文章。 */
export async function restoreTrash(slug) {
  const from = path.join(TRASH_DIR, `${slug}.md`);
  try {
    await fs.access(from);
  } catch {
    throw Object.assign(new Error(`回收箱里没有：${slug}`), { code: 'NOT_FOUND' });
  }
  await fs.mkdir(POSTS_DIR, { recursive: true });
  // ⚠️ 这里必须只看站内：用 uniqueSlug 的话，它自己还在回收箱里，
  // 会被自己挡住，恢复一次就多一层 -2（2026-11-01 实测踩到）。
  const finalSlug = await freeNameInPosts(slug);
  await fs.rename(from, path.join(POSTS_DIR, `${finalSlug}.md`));
  return { slug: finalSlug, renamed: finalSlug !== slug };
}

/**
 * 彻底删除：交给 Windows 回收站，不是 `rm`。
 *
 * 为什么绕 PowerShell：Node 没有内置的「丢进回收站」API，
 * 手写 SHFileOperation 要编译原生模块。Microsoft.VisualBasic 的
 * DeleteFile(..., SendToRecycleBin) 是系统自带、零依赖的做法。
 * 失败就**什么都不做**（宁可删不掉，也不能把文件永久删了）。
 */
export async function purgeTrash(slug) {
  const full = path.join(TRASH_DIR, `${slug}.md`);
  try {
    await fs.access(full);
  } catch {
    throw Object.assign(new Error(`回收箱里没有：${slug}`), { code: 'NOT_FOUND' });
  }
  await sendToRecycleBin(full);
  return { slug, purged: true };
}

function exists(p) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

function sendToRecycleBin(filePath) {
  if (process.platform !== 'win32') {
    // 非 Windows 没有回收站概念，退化为直接删（这个工具本来也只在 Windows 上用）
    return fs.unlink(filePath);
  }
  const quoted = filePath.replace(/'/g, "''");
  const script =
    'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${quoted}','OnlyErrorDialogs','SendToRecycleBin')`;

  // ⚠️ 必须用 -EncodedCommand（UTF-16LE 的 base64）而不是 -Command。
  // 直接传 -Command 时，脚本里的中文路径会按控制台代码页(GBK)解释，
  // PowerShell 收到一串乱码路径 → FileNotFoundException（2026-11-01 实测）。
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        reject(
          Object.assign(new Error(`交给系统回收站失败，文件还留在回收箱里：${String(stderr || err.message).trim()}`), {
            code: 'RECYCLE_FAILED',
          }),
        );
        return;
      }
      resolve();
    });
  });
}

export { POSTS_DIR as postsDir };
