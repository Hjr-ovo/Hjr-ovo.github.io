// 文章读写：全部走磁盘，不缓存
//
// 设计文档第六节：每次操作前重新读盘。文件在工具外被改过时以磁盘为准并提示冲突。
// 唯一允许写的目录是 site/src/content/posts/，站点其它文件一概不碰。

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parseDocument, patchMeta, replaceBody, validateMeta, today } from './fm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../..');
export const SITE_DIR = path.join(ROOT, 'site');
export const POSTS_DIR = path.join(SITE_DIR, 'src', 'content', 'posts');

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
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, finalText, 'utf8');
  await fs.rename(tmp, full);

  return {
    saved: true,
    changed: changedKeys,
    bodyChanged,
    slug,
    hash: sha1(finalText),
  };
}

// ---------- 分类 / 标签 ----------

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

/** 文件名是否已被占用（入库时用） */
export async function slugExists(slug) {
  try {
    await fs.access(fileOf(slug));
    return true;
  } catch {
    return false;
  }
}

export { POSTS_DIR as postsDir };
