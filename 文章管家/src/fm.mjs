// frontmatter 的解析与「最小改动」写入
//
// 这是整个工具最要紧的一个文件。两条铁律：
//   1. 解析要宽容（读不懂的行忽略，不炸），写入要保守（读不懂就拒绝写）
//   2. 保存时**只替换真正变了的那几行**，其余字节一个都不碰
//
// 第 2 条是调研之后才定的（后台工具设计.md 附录 A 第 1 条）：
// 早期设计写的是「解析成对象再整份序列化」，那样每次保存都会把 frontmatter
// 重排一遍，git diff 变成一整块，等于失去了「看清楚改了什么」的能力。

const BOM = '\uFEFF';

// 正式字段名 → 可能的历史别名（Obsidian 导出用 date/explain）
const ALIASES = {
  pubDate: ['pubDate', 'date', 'created'],
  description: ['description', 'explain', 'summary'],
};

export const FIELDS = ['title', 'description', 'pubDate', 'updatedDate', 'categories', 'tags', 'draft'];

// ---------- 切分 ----------

/**
 * 把一篇 .md 切成「frontmatter 行」+「正文原文」
 *
 * 关键点：正文用字符偏移直接 slice 出来，不做任何切分重拼 ——
 * 这样正文里的空行、行尾、缩进全都原样保留。
 */
export function splitDocument(raw) {
  const hasBOM = raw.startsWith(BOM);
  const text = hasBOM ? raw.slice(1) : raw;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  // 按物理行扫描，记下每行的起止偏移
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      const end = i + 1;
      let content = text.slice(start, i);
      if (content.endsWith('\r')) content = content.slice(0, -1);
      lines.push({ start, end, content });
      start = end;
    }
  }
  if (start < text.length) lines.push({ start, end: text.length, content: text.slice(start) });

  if (lines.length === 0 || lines[0].content.trim() !== '---') {
    throw new Error('文件开头不是 frontmatter（第一行应该只有三个短横线 ---）');
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].content.trim() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new Error('frontmatter 没有闭合（找不到结束的 --- 那一行）');
  }

  const fmLines = lines.slice(1, close).map((l) => l.content);
  // 正文：从结束行的**内容末尾**开始（含它后面的换行），到文件末尾。
  //
  // ⚠️ 这里必须从 content 末尾开始，不能用 lines[close].end：
  // end 已经跳过了结束线的行尾换行，用它切出来的正文会比原文少一个 \n，
  // 拼回去就变成「--- 和正文挤在同一行」，frontmatter 结构直接崩掉。
  const closeLine = lines[close];
  const bodyRaw = text.slice(closeLine.start + closeLine.content.length);

  return { hasBOM, eol, fmLines, bodyRaw, text };
}

/** 正文内容（去掉紧跟 frontmatter 的空白行，统一换行符，供界面编辑） */
export function bodyOf(doc) {
  return doc.bodyRaw.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\r\n/g, '\n');
}

// ---------- 解析 ----------

function stripQuotes(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseValue(value) {
  const v = value.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => stripQuotes(s.trim())).filter((s) => s !== '');
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return stripQuotes(v);
}

/**
 * 解析 frontmatter 各字段。
 * 支持内联数组 `[a, b]` 和块状数组 `categories:\n  - a`（Obsidian 常用后者）。
 */
export function parseFields(fmLines) {
  const data = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    if (/^-\s/.test(t)) continue; // 块状数组的子项，由上面的 key 收走

    const m = t.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue; // 读不懂就跳过，不在读取阶段报错

    const key = m[1];
    const rest = m[2].trim();

    if (rest === '') {
      const items = [];
      let j = i + 1;
      while (j < fmLines.length && /^\s*-\s+/.test(fmLines[j])) {
        items.push(stripQuotes(fmLines[j].replace(/^\s*-\s+/, '').trim()));
        j++;
      }
      if (items.length > 0) {
        data[key] = items;
        i = j - 1;
        continue;
      }
      data[key] = '';
      continue;
    }

    data[key] = parseValue(rest);
  }
  return data;
}

/** 完整解析：{ data, body, doc } */
export function parseDocument(raw) {
  const doc = splitDocument(raw);
  return { data: parseFields(doc.fmLines), body: bodyOf(doc), doc };
}

/** 按别名取字段（pubDate 也能从 date 拿到） */
export function pick(data, key) {
  const names = ALIASES[key] || [key];
  for (const n of names) {
    const v = data[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

// ---------- 序列化 ----------

export function yamlString(value) {
  const s = String(value);
  const needsQuote =
    s === '' ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /:\s/.test(s) ||
    s.includes(' #') ||
    /^(true|false|null|~)$/i.test(s) ||
    /^-?\d+(\.\d+)?$/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeValue(value) {
  if (Array.isArray(value)) {
    const items = value.map((s) => String(s).trim()).filter((s) => s !== '');
    return `[${items.map(yamlString).join(', ')}]`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return yamlString(String(value ?? ''));
}

// ---------- 最小改动写入 ----------

/** 找到字段所在行号（含别名） */
function findKeyLine(fmLines, key) {
  const names = ALIASES[key] || [key];
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].trim().match(/^([A-Za-z0-9_-]+)\s*:/);
    if (m && names.includes(m[1])) return i;
  }
  return -1;
}

/** 值是否相同（相同就完全不碰那一行，连引号风格都保留） */
function sameValue(a, b) {
  if (Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : a === '' || a === undefined ? [] : [String(a)];
    return aa.length === b.length && aa.every((x, i) => String(x) === String(b[i]));
  }
  if (typeof b === 'boolean') {
    if (a === b) return true;
    // 文件里没写 draft，等价于 false
    return (a === undefined || a === '') && b === false;
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

/**
 * 只改动变了的那几行。
 *
 * @param {string} raw 原文件全文
 * @param {object} changes 要写入的字段（7 个正式名）
 * @returns {{ content: string, changedKeys: string[] }}
 */
export function patchMeta(raw, changes) {
  const doc = splitDocument(raw);
  const fmLines = doc.fmLines.slice();
  const current = parseFields(fmLines);
  const changedKeys = [];

  for (const key of FIELDS) {
    if (!(key in changes)) continue;
    const next = changes[key];
    const prev = key === 'draft' ? current.draft : pick(current, key);
    if (sameValue(prev, next)) continue;

    const line = `${key}: ${serializeValue(next)}`;
    const idx = findKeyLine(fmLines, key);

    if (idx === -1) {
      fmLines.push(line);
    } else {
      // 同步删掉该字段下面的块状数组子行（统一改写成内联写法）
      let j = idx + 1;
      while (j < fmLines.length && /^\s*-\s+/.test(fmLines[j])) {
        fmLines.splice(j, 1);
      }
      fmLines[idx] = line;
    }
    changedKeys.push(key);
  }

  const head = (doc.hasBOM ? BOM : '') + '---' + doc.eol + fmLines.join(doc.eol) + doc.eol + '---';
  return { content: head + doc.bodyRaw, changedKeys };
}

/** 正文变了才整体替换正文
 *
 * 原则（设计文档 F3 第 3 条）：正文不做任何格式化。
 * 所以这里只换「正文内容」，前面那几个空行和结尾有没有换行，
 * 都沿用原文件的状态 —— 否则每次保存都会在文件末尾偷偷多出/少掉一个换行，
 * git diff 里就是一条无意义的改动。
 */
export function replaceBody(raw, body) {
  const doc = splitDocument(raw);
  const head = (doc.hasBOM ? BOM : '') + '---' + doc.eol + doc.fmLines.join(doc.eol) + doc.eol + '---';

  const lead = (doc.bodyRaw.match(/^(?:[ \t]*\r?\n)+/) || [''])[0];
  const tail = /\r?\n$/.test(doc.bodyRaw) ? doc.eol : '';

  const text = String(body).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return head + lead + text.replace(/\n/g, doc.eol) + tail;
}

// ---------- 杂项 ----------

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isValidDate(value) {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 写入前的硬校验：宁可拒绝，也不写出一份格式可疑的文件 */
export function validateMeta(meta) {
  const problems = [];
  if (!String(meta.title || '').trim()) problems.push('标题不能为空');
  if (!String(meta.description || '').trim()) problems.push('摘要不能为空（构建会失败）');
  if (!String(meta.pubDate || '').trim()) problems.push('发布日期不能为空');
  else if (!isValidDate(meta.pubDate)) problems.push(`发布日期格式不对：${meta.pubDate}（要 YYYY-MM-DD）`);
  if (meta.updatedDate && !isValidDate(meta.updatedDate)) {
    problems.push(`更新日期格式不对：${meta.updatedDate}（要 YYYY-MM-DD）`);
  }
  const cats = (meta.categories || []).map((s) => String(s).trim()).filter(Boolean);
  if (cats.length === 0) problems.push('至少要有一个分类');
  if (new Set(cats).size !== cats.length) problems.push('分类有重复项');
  return problems;
}
