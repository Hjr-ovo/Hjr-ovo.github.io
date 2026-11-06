// 入库：拖一个 .md 进来 → 诊断 → 起名归类 → 写进站点
//
// 这条链路是整套工具唯一「新造」的东西（设计文档 F2）。
// 核心原则：**诊断只预测，不改文件**；写入时正文逐字节不动。
//
// 2026-11-01 按用户反馈改了五处，这条链路才好用：
//   1. 文件名自动从文章名生成，重名自动加序号（-2 / -3），不用手改
//   2. 标题直接取文件名
//   3. 文件开头**可以没有** frontmatter（--- 包起来的元数据块）
//   4. date / tags / explain 都不是必须的，有就用、没有就给默认
//   5. 分类可以空着

import fs from 'node:fs/promises';
import path from 'node:path';

import { splitDocumentLoose, parseFields, bodyOf, pick, today } from './fm.mjs';
import { slugify, slugifyAsync } from './slug.mjs';
import { POSTS_DIR, listPosts, readingStats, uniqueSlug, writeAtomic } from './posts.mjs';

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
  // 系列（2026-11-04 加）：列进来才不会在下面「未知字段原样保留」那段
  // 又输出一遍，否则文件里会出现两行 series
  'series',
  'seriesOrder',
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

/** 去掉行内 Markdown 记号，只要纯文字（摘要自动截取用） */
function plainText(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 正文第一段（没有摘要时自动拿来当摘要）。
 * 跳过标题、引用、列表、表格、图片、水平线 —— 那些当摘要没意义。
 */
function firstParagraph(body) {
  const buf = [];
  for (const line of splitCodeBlocks(body)) {
    if (line === null) {
      if (buf.length) break;
      continue;
    }
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (/^(#{1,6}\s|\||>|[-*+]\s|\d+\.\s|!\[|```|---+\s*$|<)/.test(t)) {
      if (buf.length) break;
      continue;
    }
    buf.push(t);
  }
  return plainText(buf.join(' '));
}

/** 太长就截断，别把整段搬进列表页 */
function clip(text, max = 80) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

/**
 * 诊断：只读，不写任何文件。
 *
 * @param {string} raw 文件全文
 * @param {{ filename?: string, existingCategories?: string[], reserved?: string[] }} ctx
 *   reserved：同一批里已经分出去、但还没落盘的文件名
 */
export async function analyze(raw, ctx = {}) {
  const checks = [];
  const add = (level, text) => checks.push({ level, text });

  if (raw.startsWith('\uFEFF')) add('info', '文件带 UTF-8 BOM，写入时会去掉');

  // 宽松切分：没有 frontmatter 也能继续，全文当正文
  const doc = splitDocumentLoose(raw);
  const data = parseFields(doc.fmLines);
  const body = bodyOf(doc);
  const stats = readingStats(body);
  const headings = headingLevels(body);

  if (doc.hasFrontmatter) {
    const n = doc.fmLines.filter((l) => l.trim() !== '').length;
    add('info', `读到了 frontmatter（${n} 行元数据），写入时会按站点规范重排`);
  } else {
    add('info', doc.note || '文件开头没有 frontmatter —— 全文当正文，元数据入库时自动生成');
  }

  // ---- 标题：按用户要求**直接取文件名** ----
  const fileBase = ctx.filename ? String(ctx.filename).replace(/\.(md|markdown)$/i, '').trim() : '';
  const fmTitle = String(data.title ?? '').trim();
  const h1 = headings.find((h) => h.level === 1);
  const title = fileBase || fmTitle || (h1 ? h1.text : '');

  if (title) {
    add('info', fileBase ? `标题取自文件名：「${title}」` : fmTitle ? `没有文件名可用，标题取自 frontmatter：「${title}」` : `标题取自正文第一个 h1：「${title}」`);
  } else {
    add('error', '既没有文件名也没有 title —— 标题得手填');
  }

  // frontmatter 里有别的标题时，只提示、不擅自采用（用户要的是文件名）
  if (fmTitle && fileBase && fmTitle !== fileBase) {
    add('info', `frontmatter 里还写着一个标题「${fmTitle}」`);
  }

  // ---- 摘要：没有就截正文第一段 ----
  const descFromFile = String(data.description ?? data.explain ?? data.summary ?? '').trim();
  const firstPara = firstParagraph(body);
  const description = descFromFile || clip(firstPara);
  if (descFromFile) add('info', '摘要来自 frontmatter 的 ' + (data.description ? 'description' : data.explain ? 'explain' : 'summary'));
  else if (description) add('info', `没有摘要，自动截取正文第一段：「${clip(description, 30)}」`);
  else add('warn', '没有摘要，正文首段也取不到 —— 需要手填');

  // ---- 日期：一律用今天（2026-11-05 用户要求）----
  //   原文件里的 date / pubDate 是「写笔记那天」，不是「发到站点那天」。
  //   Obsidian 导出的笔记几乎都带 date，沿用的话每篇都得手改一遍，
  //   所以这里默认按今天走；要发成别的日子，在弹窗的发布日期那一栏改。
  const dateRaw = pick(data, 'pubDate');
  const originalDate = dateRaw ? String(dateRaw).slice(0, 10) : '';
  if (dateRaw) add('info', `发布日期用今天（原文件写的 ${originalDate} 没沿用）`);
  else add('info', `没有发布日期，用今天：${today()}`);

  // ---- h1 与标题层级 ----
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count > 0) add('info', `正文有 ${h1Count} 个 h1，构建时会整体降一级（remark-obsidian 插件接管）`);

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

  // ---- == 高亮 ----
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

  // ---- 图片 ----
  const images = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  const localImg = images.filter((u) => !/^(https?:)?\/\//i.test(u) && !u.startsWith('data:'));
  if (images.length > 0) {
    if (localImg.length > 0) {
      add('error', `${localImg.length} 张本地图片（如 ${localImg[0]}）—— 站点上会裂，请先传图床换成 https 链接`);
    } else {
      add('ok', `${images.length} 张图片，全部是网络链接`);
    }
  }

  // ---- 体量 ----
  add('info', `${stats.chars} 字 · ${stats.codeLines} 行代码 · 预计阅读 ${stats.minutes} 分钟`);

  // ---- 多余字段 ----
  const unknown = Object.keys(data).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknown.length > 0) add('info', `有 ${unknown.length} 个站点用不到的字段（${unknown.join('、')}），会被忽略但保留在文件里`);

  // ---- 分类：可空 ----
  const rawCats = data.categories ?? data.category;
  const cats = (Array.isArray(rawCats) ? rawCats : rawCats ? [rawCats] : []).map(String).filter(Boolean);
  const existing = new Set(ctx.existingCategories || []);
  const fresh = cats.filter((c) => !existing.has(c));
  if (cats.length === 0) {
    add('info', '没有分类');
  } else if (fresh.length > 0) {
    add('info', `分类「${fresh.join('、')}」是新的，会新建对应的分类页`);
  }

  // ---- 文件名：自动生成 + 重名自动加序号 ----
  // reserved 是同一批里前面几篇刚分到的名字（还没落盘），见 uniqueSlug 的注释
  // 主路径走本地模型（slugifyAsync），模型不可用时它内部会退回词表
  const seed = await slugifyAsync(fileBase || title);
  const slug = await uniqueSlug(seed, ctx.reserved);
  if (slug !== seed) add('warn', `「${seed}」这个名字已经有人用了（站里或这一批里），自动改成「${slug}」`);
  if (!fileBase && !title) add('error', '没有可用的名字，文件名只能手填');

  // 其他可选名字：frontmatter 的 slug、另一个标题、按日期兜底
  const altSlugs = [];
  const fmSlug = String(data.slug ?? '').trim();
  if (fmSlug) altSlugs.push(fmSlug);
  if (fmTitle && fmTitle !== title) altSlugs.push(slugify(fmTitle));
  altSlugs.push(`post-${today()}`);
  const slugCandidates = [...new Set(altSlugs)].filter((s) => s && s !== slug);

  // 标题候选（给「用 frontmatter 标题」留一个按钮）
  const altTitles = [];
  if (fmTitle && fmTitle !== title) altTitles.push({ label: '用 frontmatter 的标题', value: fmTitle });
  if (h1 && h1.text && h1.text !== title && h1.text !== fmTitle) altTitles.push({ label: '用正文 h1', value: h1.text });

  const hasError = checks.some((c) => c.level === 'error');

  return {
    checks,
    hasError,
    hasFrontmatter: doc.hasFrontmatter,
    meta: {
      title,
      description,
      pubDate: today(),
      categories: cats,
      tags: (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []).map(String),
      draft: data.draft === true,
      // 系列两个字段跟着导入走：从 Obsidian 复制来的笔记里如果写了，
      // 就不用在弹窗里再填一遍
      series: data.series ? String(data.series).trim() : '',
      seriesOrder:
        data.seriesOrder === undefined || data.seriesOrder === null
          ? ''
          : String(data.seriesOrder),
    },
    body,
    bodyRaw: doc.bodyRaw,
    eol: doc.eol,
    unknownFields: unknown,
    unknownValues: Object.fromEntries(unknown.map((k) => [k, data[k]])),
    stats,
    h1Count,
    descFromFile: Boolean(descFromFile),
    slug,
    slugSeed: seed,
    slugCandidates: slugCandidates.slice(0, 4),
    altTitles,
  };
}

/**
 * 写入：frontmatter 按规范重排，正文逐字节保留。
 *
 * 文件名重复不再报错 —— 自动加序号，这是用户要的「自动处理」。
 */
export async function writePost({ raw, slug, meta }) {
  let wanted = String(slug || '').trim();

  if (!wanted) wanted = slugify(meta?.title || '');
  if (!wanted) throw Object.assign(new Error('文件名不能为空'), { code: 'BAD_SLUG' });

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wanted)) {
    if (/^[^a-z0-9]/.test(wanted) || /[A-Z]/.test(wanted)) {
      throw Object.assign(new Error('文件名只能用「小写字母、数字、短横线」，且不能以短横线开头'), { code: 'BAD_SLUG' });
    }
    throw Object.assign(new Error('文件名不合法：只能用「小写字母、数字、短横线」'), { code: 'BAD_SLUG' });
  }

  const finalSlug = await uniqueSlug(wanted);

  const doc = splitDocumentLoose(raw);
  const data = parseFields(doc.fmLines);

  const problems = [];
  if (!String(meta.title || '').trim()) problems.push('标题不能为空');
  if (!String(meta.description || '').trim()) problems.push('摘要不能为空');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.pubDate || ''))) problems.push('日期格式要 YYYY-MM-DD');
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
  // 分类允许为空数组：站点 schema 也从 min(1) 放宽到 default([])
  lines.push(`categories: ${arr(meta.categories || [])}`);
  lines.push(`tags: ${arr(meta.tags || [])}`);
  lines.push(`draft: ${meta.draft === true ? 'true' : 'false'}`);

  // 系列（选填）：没填就完全不写这两行。每篇都挂一个空的 `series: ""`
  // 会让站点把它们算成同一个「无名系列」，反而把没关系的文章聚成一组
  const seriesName = String(meta.series || '').trim();
  if (seriesName) lines.push(`series: ${q(seriesName)}`);

  const seriesOrder = Number(meta.seriesOrder);
  const hasSeriesOrder =
    meta.seriesOrder !== '' &&
    meta.seriesOrder !== undefined &&
    meta.seriesOrder !== null;
  // 裸数字：站点 schema 是 z.number()，yamlString 习惯给纯数字加引号，
  // 这里会变成字符串 "2" 直接校验失败，所以不走 q()
  if (hasSeriesOrder && Number.isInteger(seriesOrder) && seriesOrder >= 0) {
    lines.push(`seriesOrder: ${seriesOrder}`);
  }

  // Obsidian 专有字段（aliases、cssclasses…）原样保留在末尾
  for (const key of Object.keys(data)) {
    if (KNOWN_FIELDS.has(key)) continue;
    const v = data[key];
    if (Array.isArray(v)) lines.push(`${key}: ${arr(v)}`);
    else if (typeof v === 'boolean') lines.push(`${key}: ${v}`);
    else lines.push(`${key}: ${q(v)}`);
  }

  const text = `---\n${lines.join('\n')}\n---\n\n${bodyOf(doc).replace(/\r\n/g, '\n')}\n`;
  const full = path.join(POSTS_DIR, `${finalSlug}.md`);
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await writeAtomic(full, text.replace(/\n/g, doc.eol));

  return { slug: finalSlug, url: `/posts/${finalSlug}/`, chars: readingStats(bodyOf(doc)).chars, renamed: finalSlug !== wanted };
}

/** 现有分类名（入库时给下拉候选） */
export async function existingCategories() {
  const { posts } = await listPosts();
  return [...new Set(posts.flatMap((p) => p.categories))].sort((a, b) => a.localeCompare(b, 'zh'));
}
