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
    // 系列（2026-11-04 加）：空串交给 patchMeta 处理成「删掉这一行」，
    // 序号在这里不做转换，非法值由 toSeriesOrder 抛错、接口回 400
    series: String(meta.series ?? '').trim(),
    seriesOrder:
      meta.seriesOrder === '' || meta.seriesOrder === undefined || meta.seriesOrder === null
        ? ''
        : meta.seriesOrder,
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

  // 手动建过、但暂时没有文章引用的项：从持久化清单补进来，计数 0。
  // 分类 / 标签平时是「从文章现算」的，没有独立存储；不补这一步，
  // 新建的分类会因为没有任何文章而立刻从抽屉里消失。
  const extra = await readExtra();
  for (const c of extra.categories) if (!catMap.has(c)) catMap.set(c, 0);
  for (const t of extra.tags) if (!tagMap.has(t)) tagMap.set(t, 0);

  const toArr = (m) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));

  return { categories: toArr(catMap), tags: toArr(tagMap), descs: await readCategoryDescs(), today: today() };
}

// ---------- 分类 / 标签 的增删改 ----------
//
// 分类和标签本来是「从所有文章的 frontmatter 现算」的，没有独立存储。
// 但「新建」一个暂时没挂文章的分类时，现算就拿不到它，于是这里补一个很小的
// 持久化清单，只存**零计数**的名字；文章仍然是计数和归类的事实来源。
// 改名 / 删除则要扫全部文章，把引用一起改掉。

const TAXONOMY_FILE = path.resolve(__dirname, '../taxonomy-extra.json');
const KIND_LABEL = { categories: '分类', tags: '标签' };

function kindKey(kind) {
  if (kind === 'categories') return 'categories';
  if (kind === 'tags') return 'tags';
  throw Object.assign(new Error('只能是 tags 或 categories'), { code: 'INVALID' });
}

function normTerm(name) {
  const term = String(name ?? '').trim();
  if (!term) throw Object.assign(new Error('名称不能为空'), { code: 'INVALID' });
  return term;
}

async function readExtra() {
  try {
    const raw = await fs.readFile(TAXONOMY_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    };
  } catch {
    return { categories: [], tags: [] };
  }
}

async function writeExtra(data) {
  const clean = {
    categories: [...new Set(data.categories.map((s) => String(s).trim()).filter(Boolean))],
    tags: [...new Set(data.tags.map((s) => String(s).trim()).filter(Boolean))],
  };
  await writeAtomic(TAXONOMY_FILE, JSON.stringify(clean, null, 2) + '\n');
}

/** 当前所有名字（含零计数项） */
async function allNames(key) {
  const tx = await taxonomy();
  return tx[key].map((it) => it.name);
}

/** 把一篇文章的某个字段整体换成 next（用于改名 / 删除时批量改引用） */
async function writeTermsOfPost(slug, key, next) {
  const current = await readPost(slug);
  const { content, changedKeys } = patchMeta(current.raw, { [key]: next });
  if (changedKeys.length === 0) return false;
  await writeAtomic(fileOf(slug), content);
  return true;
}

/** 新建一个分类 / 标签（暂时没挂文章也能存在） */
export async function createTerm(kind, name) {
  const key = kindKey(kind);
  const term = normTerm(name);

  if ((await allNames(key)).includes(term)) {
    throw Object.assign(new Error(`已经有${KIND_LABEL[key]}「${term}」了`), { code: 'EXISTS' });
  }

  const extra = await readExtra();
  extra[key].push(term);
  await writeExtra(extra);
  return { created: true, kind: key, name: term };
}

/** 改名：所有引用它的文章一起改，清单里的零计数项也改 */
export async function renameTerm(kind, oldName, newName) {
  const key = kindKey(kind);
  const from = normTerm(oldName);
  const to = normTerm(newName);
  if (from === to) return { renamed: false, kind: key, oldName: from, newName: to, affected: 0 };

  const names = await allNames(key);
  if (!names.includes(from)) {
    throw Object.assign(new Error(`没有${KIND_LABEL[key]}「${from}」`), { code: 'NOT_FOUND' });
  }
  if (names.includes(to)) {
    throw Object.assign(new Error(`已经有「${to}」了，换个名字`), { code: 'EXISTS' });
  }

  const { posts } = await listPosts();
  let affected = 0;
  for (const p of posts) {
    const list = key === 'categories' ? p.categories : p.tags;
    if (!list.includes(from)) continue;
    const next = list.map((x) => (x === from ? to : x));
    if (await writeTermsOfPost(p.slug, key, next)) affected++;
  }

  const extra = await readExtra();
  if (extra[key].includes(from)) {
    extra[key] = extra[key].map((x) => (x === from ? to : x));
    await writeExtra(extra);
  }

  // 简介跟着分类走，不然改完名字简介就挂在一个不存在的分类上了
  if (key === 'categories') await syncDescOnRename(from, to);

  return { renamed: true, kind: key, oldName: from, newName: to, affected };
}

/** 删除：所有引用它的文章都移掉这一项，清单里也删掉；文章本身不动 */
export async function deleteTerm(kind, name) {
  const key = kindKey(kind);
  const term = normTerm(name);

  if (!(await allNames(key)).includes(term)) {
    throw Object.assign(new Error(`没有${KIND_LABEL[key]}「${term}」`), { code: 'NOT_FOUND' });
  }

  const { posts } = await listPosts();
  let affected = 0;
  for (const p of posts) {
    const list = key === 'categories' ? p.categories : p.tags;
    if (!list.includes(term)) continue;
    const next = list.filter((x) => x !== term);
    if (await writeTermsOfPost(p.slug, key, next)) affected++;
  }

  const extra = await readExtra();
  if (extra[key].includes(term)) {
    extra[key] = extra[key].filter((x) => x !== term);
    await writeExtra(extra);
  }

  // 分类删了，它的简介也一起清掉
  if (key === 'categories') await syncDescOnDelete(term);

  return { deleted: true, kind: key, name: term, affected };
}

// ---------- 分类简介 ----------
//
// 简介是「分类」自己的属性，不属于任何一篇文章，所以没法存 frontmatter，
// 它写在博客仓库的 site/src/data/categories.ts 里（分类页构建时 import 它）。
// 这是本工具**唯一**会写的非文章文件，所以要格外小心：
//   读 = 用正则把键值对抠出来；写 = 整份重新生成。
//
// ⚠️ 重新生成会丢掉文件里原有的注释，所以文件头固定由这里写。
//    手工加的行能读回来（下次保存时保留），手写的注释则会消失。

const DESC_FILE = path.join(SITE_DIR, 'src', 'data', 'categories.ts');

const DESC_HEADER = `// 分类说明：给每个分类写一句简介。
//
// 显示在「分类」总览页的卡片上，以及该分类详情页的标题下方。
// 只出现在本表的分类才显示说明；没写的分类不显示，不影响其它功能。
//
// ⚠️ 这个文件由文章管家的「编辑简介」生成，保存时会整份重写（这里原有的注释会丢）。
// 手工加行也可以，格式照 '分类名': '说明', —— 在管家里改别的分类时会把它读进来。

`;

// 单引号或双引号字符串（认转义），用来匹配 `'名字': '说明'`
const STR_SRC = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const DESC_PAIR = new RegExp(`(${STR_SRC})\\s*:\\s*(${STR_SRC})`, 'g');

function unescapeJs(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, c) => {
    if (c.length === 5 && c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c.length === 3 && c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === 'r') return '\r';
    return c;
  });
}

function escapeJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ');
}

function parseDescFile(raw) {
  const at = raw.indexOf('CATEGORY_DESC');
  const start = at >= 0 ? raw.indexOf('{', at) : -1;
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};

  // 先按行剔掉注释，避免把注释掉的示例行读成真数据
  const body = raw
    .slice(start + 1, end)
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  const descs = {};
  DESC_PAIR.lastIndex = 0;
  let m;
  while ((m = DESC_PAIR.exec(body))) {
    const key = unescapeJs(m[1].slice(1, -1)).trim();
    const val = unescapeJs(m[2].slice(1, -1)).trim();
    if (key && val) descs[key] = val;
  }
  return descs;
}

function renderDescFile(descs) {
  const lines = Object.entries(descs).map(([k, v]) => `  '${escapeJs(k)}': '${escapeJs(v)}',`);
  return `${DESC_HEADER}export const CATEGORY_DESC: Record<string, string> = {\n${lines.map((l) => l + '\n').join('')}};\n`;
}

export async function readCategoryDescs() {
  try {
    return parseDescFile(await fs.readFile(DESC_FILE, 'utf8'));
  } catch {
    return {}; // 文件不在 = 一个简介都没写，不是错误
  }
}

async function writeCategoryDescs(map) {
  await fs.mkdir(path.dirname(DESC_FILE), { recursive: true });
  await writeAtomic(DESC_FILE, renderDescFile(map));
}

/** 设/清一个分类的简介。desc 传空串 = 删掉这条简介（文件里那行消失）。 */
export async function setCategoryDesc(name, desc) {
  const term = normTerm(name);
  if (!(await allNames('categories')).includes(term)) {
    throw Object.assign(new Error(`没有分类「${term}」`), { code: 'NOT_FOUND' });
  }

  const text = String(desc ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const map = await readCategoryDescs();
  const has = Object.prototype.hasOwnProperty.call(map, term);

  if (!text) {
    if (!has) return { name: term, desc: '', changed: false };
    delete map[term];
  } else {
    if (map[term] === text) return { name: term, desc: text, changed: false };
    map[term] = text;
  }

  await writeCategoryDescs(map);
  return { name: term, desc: text, changed: true };
}

/** 改名 / 删除分类时，把简介跟着搬走或清掉（否则会留在一个不存在的名字上） */
async function syncDescOnRename(from, to) {
  const map = await readCategoryDescs();
  if (!Object.prototype.hasOwnProperty.call(map, from)) return;
  const next = {};
  for (const [k, v] of Object.entries(map)) next[k === from ? to : k] = v;
  await writeCategoryDescs(next);
}

async function syncDescOnDelete(name) {
  const map = await readCategoryDescs();
  if (!Object.prototype.hasOwnProperty.call(map, name)) return;
  delete map[name];
  await writeCategoryDescs(map);
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
 *
 * `reserved` 是**还没落盘**的名字（同一批入库里前面几篇刚分到的）。
 * 批量入库时六篇在磁盘上都还不存在，只查磁盘会让它们全拿到同一个名字，
 * 弹窗里六行长得一模一样 —— 所以由调用方把这一批已经用掉的名单递进来。
 */
export async function uniqueSlug(base, reserved = []) {
  const clean = String(base || '').trim() || 'post';
  const taken = new Set(Array.isArray(reserved) ? reserved : []);
  const free = async (name) => !taken.has(name) && !(await slugExists(name));

  if (await free(clean)) return clean;
  for (let n = 2; n < 1000; n++) {
    const cand = `${clean}-${n}`;
    if (await free(cand)) return cand;
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
