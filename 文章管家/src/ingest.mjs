// 入库：拖一个 .md 进来 → 诊断 → 起名归类 → 写进站点
//
// 这条链路是整套工具唯一「新造」的东西（设计文档 F2）。
// 核心原则：**诊断只预测，不改文件**；写入时正文逐字节不动。

import fs from 'node:fs/promises';
import path from 'node:path';

import { splitDocument, parseFields, bodyOf, pick, today } from './fm.mjs';
import { slugify } from './slug.mjs';
import { POSTS_DIR, listPosts, readingStats, slugExists } from './posts.mjs';

const KNOWN_FIELDS = new Set([
  'title',
  'description',
  'pubDate',
  'date',
  'created',
  'updatedDate',
  'categories',
  'category',
  'tags',
  'draft',
  'slug',
  'explain',
  'summary',
]);

/** 把正文切成「代码块之外」的行，避免误统计代码里的 == 与 # */
function splitCodeBlocks(body) {
  const lines = body.split('\n');
  const plain = [];
  let inFence = false;
  let fenceMark = '';

  for (const line of lines) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fenceMark = m[1][0];
        plain.push(null);
        continue;
      }
      if (m[1][0] === fenceMark) {
        inFence = false;
        fenceMark = '';
        plain.push(null);
        continue;
      }
    }
    plain.push(inFence ? null : line);
  }
  return plain;
}

function headingLevels(body) {
  const plain = splitCodeBlocks(body);
  const out = [];
  plain.forEach((line, i) => {
    if (line === null) return;
    const m = line.match(/^(#{1,6})\s+\S/);
    if (m) out.push({ level: m[1].length, line: i + 1, text: line.replace(/^#+\s+/, '').trim() });
  });
  return out;
}

/**
 * 诊断：只读，不写任何文件。
 *
 * @param {string} raw 文件全文
 * @param {{ filename?: string, existingCategories?: string[] }} ctx
 */
export function analyze(raw, ctx = {}) {
  const checks = [];
  const add = (level, text) => checks.push({ level, text });

  const hasBOM = raw.startsWith('\uFEFF');
  if (hasBOM) add('info', '文件带 UTF-8 BOM，写入时会去掉（BOM 会让 YAML 解析诡异失败）');

  let doc;
  try {
    doc = splitDocument(raw);
  } catch (err) {
    add('error', `无法解析：${err.message}`);
    return { checks, meta: null, body: '', slugCandidates: [], unknownFields: [] };
  }

  const data = parseFields(doc.fmLines);
  const body = bodyOf(doc);
  const stats = readingStats(body);
  const headings = headingLevels(body);

  // D1 标题
  let title = String(data.title ?? '').trim();
  if (title) {
    add('info', `标题来自 frontmatter 的 title：「${title}」`);
  } else {
    const h1 = headings.find((h) => h.level === 1);
    title = h1 ? h1.text : '';
    add(h1 ? 'warn' : 'error', h1 ? `没写 title，将取正文第一个 h1：「${title}」` : '既没有 title，正文里也没有 h1 —— 请手填');
  }

  // D2 必填
  const desc = String(data.description ?? data.explain ?? data.summary ?? '').trim();
  if (!desc) add('warn', '缺少 description / explain（摘要）—— 入库时必须手填，否则构建失败，列表页也会是空的');

  const dateRaw = pick(data, 'pubDate');
  if (!dateRaw) add('info', `没有发布日期，将用今天：${today()}`);

  // D4 h1 数量
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 0) add('info', `正文有 ${h1Count} 个 h1，构建时会整体降一级（remark-obsidian 插件接管）`);

  // D5 跳级
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const cur = headings[i];
    if (cur.level - prev.level > 1) {
      const after = cur.level + (h1Count > 0 ? 1 : 0);
      add(
        'warn',
        `正文第 ${cur.line} 行：「${prev.text}」(${'#'.repeat(prev.level)}) 后面直接跟了 ${'#'.repeat(cur.level)}「${cur.text}」，` +
          `跳级了${after > 6 ? '，降级后会超过 h6，目录收不到' : '，目录里会缺一层'}`,
      );
    }
  }

  // D6 / D7 == 高亮
  const plain = splitCodeBlocks(body);
  let pairs = 0;
  let strayLine = 0;
  for (let i = 0; i < plain.length; i++) {
    const line = plain[i];
    if (line === null) continue;
    const hits = (line.match(/==/g) || []).length;
    pairs += Math.floor(hits / 2);
    if (hits % 2 === 1) strayLine = i + 1;
  }
  if (pairs > 0) add('info', `${pairs} 处 ==高亮== 会转成 <mark>；代码块内的 == 不会被碰`);
  if (strayLine) add('warn', `正文第 ${strayLine + 1} 行有落单的 ==（不成对），会原样露出来`);

  // D8 图片
  const images = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  const localImg = images.filter((u) => !/^(https?:)?\/\//i.test(u) && !u.startsWith('data:'));
  if (images.length > 0) {
    if (localImg.length > 0) {
      add('error', `${localImg.length} 张本地图片（如 ${localImg[0]}）—— 站点上会裂，请先传图床换成 https 链接`);
    } else {
      add('ok', `${images.length} 张图片，全部是网络链接`);
    }
  }

  // D9 体量
  add('info', `${stats.chars} 字 · ${stats.codeLines} 行代码 · 预计阅读 ${stats.minutes} 分钟`);

  // D11 多余字段
  const unknown = Object.keys(data).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknown.length > 0) add('info', `有 ${unknown.length} 个站点用不到的字段（${unknown.join('、')}），会被忽略但保留在文件里`);

  // D12 分类
  const rawCats = data.categories ?? data.category;
  const cats = Array.isArray(rawCats) ? rawCats : rawCats ? [rawCats] : [];
  const existing = new Set(ctx.existingCategories || []);
  const fresh = cats.filter((c) => !existing.has(String(c)));
  if (cats.length === 0) {
    add('warn', '没有分类 —— 入库时必须至少选一个，否则文章在分类页里是孤儿');
  } else if (fresh.length > 0) {
    add('info', `分类「${fresh.join('、')}」是新的，会新建对应的分类页`);
  }

  // 起名候选
  const slugCandidates = [];
  const fromFM = String(data.slug ?? '').trim();
  if (fromFM) slugCandidates.push(fromFM);
  const auto = slugify(title);
  if (auto && !slugCandidates.includes(auto)) slugCandidates.push(auto);
  if (ctx.filename) {
    const base = String(ctx.filename).replace(/\.md$/i, '').replace(/[^\x20-\x7e]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    if (base && !slugCandidates.includes(base)) slugCandidates.push(base);
  }
  slugCandidates.push(`topic-${today()}`);

  const hasError = checks.some((c) => c.level === 'error');

  return {
    checks,
    hasError,
    meta: {
      title,
      description: desc,
      pubDate: String(dateRaw || today()).slice(0, 10),
      categories: cats.map(String),
      tags: (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []).map(String),
      draft: data.draft === true,
    },
    body,
    bodyRaw: doc.bodyRaw,
    eol: doc.eol,
    unknownFields: unknown,
    unknownValues: Object.fromEntries(unknown.map((k) => [k, data[k]])),
    stats,
    h1Count,
    slugCandidates: [...new Set(slugCandidates)].filter(Boolean).slice(0, 4),
  };
}

/**
 * 写入：frontmatter 按规范重排，正文逐字节保留。
 */
export async function writePost({ raw, slug, meta }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    if (/^[^a-z0-9]/.test(slug) || /[A-Z]/.test(slug)) {
      throw Object.assign(new Error('文件名只能用「小写字母、数字、短横线」，且不能以短横线开头'), { code: 'BAD_SLUG' });
    }
    throw Object.assign(new Error('文件名不合法：只能用「小写字母、数字、短横线」'), { code: 'BAD_SLUG' });
  }
  if (await slugExists(slug)) {
    throw Object.assign(new Error(`已经有一篇叫 ${slug}.md 的文章了，换个名字`), { code: 'EXISTS' });
  }

  const doc = splitDocument(raw);
  const data = parseFields(doc.fmLines);

  const problems = [];
  if (!String(meta.title || '').trim()) problems.push('标题不能为空');
  if (!String(meta.description || '').trim()) problems.push('摘要不能为空');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.pubDate || ''))) problems.push('日期格式要 YYYY-MM-DD');
  if (!Array.isArray(meta.categories) || meta.categories.filter(Boolean).length === 0) problems.push('至少要有一个分类');
  if (problems.length) throw Object.assign(new Error(problems.join('；')), { code: 'INVALID' });

  const q = (v) => {
    const s = String(v);
    const needs = s === '' || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /:\s/.test(s) || s.includes(' #') || /^(true|false|null|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
    return needs ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
  };
  const arr = (list) => `[${list.map((s) => String(s).trim()).filter(Boolean).map(q).join(', ')}]`;

  const lines = [
    `title: ${q(meta.title.trim())}`,
    `description: ${q(meta.description.trim())}`,
    `pubDate: ${meta.pubDate}`,
  ];
  if (meta.updatedDate) lines.push(`updatedDate: ${meta.updatedDate}`);
  lines.push(`categories: ${arr(meta.categories)}`);
  lines.push(`tags: ${arr(meta.tags || [])}`);
  lines.push(`draft: ${meta.draft === true ? 'true' : 'false'}`);

  // Obsidian 专有字段（aliases、cssclasses…）原样保留在末尾
  for (const key of Object.keys(data)) {
    if (KNOWN_FIELDS.has(key)) continue;
    const v = data[key];
    if (Array.isArray(v)) lines.push(`${key}: ${arr(v)}`);
    else if (typeof v === 'boolean') lines.push(`${key}: ${v}`);
    else lines.push(`${key}: ${q(v)}`);
  }

  const text = `---\n${lines.join('\n')}\n---\n\n${bodyOf(doc).replace(/\r\n/g, '\n')}\n`;
  const full = path.join(POSTS_DIR, `${slug}.md`);
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, text.replace(/\n/g, doc.eol), 'utf8');
  await fs.rename(tmp, full);

  return { slug, url: `/posts/${slug}/`, chars: readingStats(bodyOf(doc)).chars };
}

/** 现有分类名（入库时给下拉候选） */
export async function existingCategories() {
  const { posts } = await listPosts();
  return [...new Set(posts.flatMap((p) => p.categories))].sort((a, b) => a.localeCompare(b, 'zh'));
}
