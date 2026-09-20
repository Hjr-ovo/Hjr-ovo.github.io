// frontmatter 的解析与拼装
//
// 这是整个工具里**最要紧**的一个文件。
//
// 为什么：frontmatter 格式错一个字，Astro 构建就整个失败
// （架构设计.md 实测过：pubDate 写成文字 → 构建 exit 1）。
// 所以这里的原则是：**宁可拒绝，也不写出一份格式可疑的文件**。
//
// 我们没有引入 YAML 库，原因见 技术架构.md 第四节：
//   本项目的 frontmatter 是**扁平的**（没有嵌套结构），
//   逐行处理足够，而少一个依赖就少一份"半年后跑不起来"的风险。
//   代价是要自己处理边界情况 —— 所以下面写得很啰嗦。

// ---------- 字段定义 ----------

// 必填字段（缺了 Astro 会报错）
export const REQUIRED_FIELDS = ['title', 'description', 'pubDate', 'category'];

// 选填字段
export const OPTIONAL_FIELDS = ['updatedDate', 'tags', 'draft'];

// ---------- 解析 ----------

/**
 * 把一篇 .md 文件的全文拆成 { data, body }
 *
 * @param {string} raw 文件全文
 * @returns {{ data: object, body: string }}
 * @throws {Error} 格式不对时抛出，由上层转成界面提示
 */
export function parseFrontmatter(raw) {
  // 统一换行符。Windows 上文件可能是 \r\n，先归一化免得后面到处判断。
  const text = raw.replace(/\r\n/g, '\n');

  // 必须以 --- 开头，否则不是一篇合格的文章
  if (!text.startsWith('---\n') && text.trimStart().startsWith('---')) {
    // 前面有空白的情况，做个宽容处理
  }
  if (!text.startsWith('---\n')) {
    throw new Error(
      '文件开头找不到 frontmatter（第一行应该只有三个短横线 ---）。' +
        '这篇文章可能是手工创建的、格式不对，工具无法安全解析。',
    );
  }

  // 找结束的分隔线：从第 2 行起，第一个内容为 "---" 的行
  const lines = text.split('\n');
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error(
      'frontmatter 没有闭合（缺少结束的 --- 那一行）。' +
        '这就等于文件被切开了一半，工具不敢动手。',
    );
  }

  const fmLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join('\n').replace(/^\n/, '');

  return { data: parseFields(fmLines), body };
}

/**
 * 解析 frontmatter 里的字段行
 */
function parseFields(fmLines) {
  const result = {};

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // 字段格式：key: value
    const colonAt = trimmed.indexOf(':');
    if (colonAt === -1) {
      // 没有冒号 —— 可能是上一行折行过来的（我们的字段都短，不该出现）
      throw new Error(
        `frontmatter 里有一行看不懂：\`${trimmed}\`。` +
          '每行应该是「字段名: 值」的形式。',
      );
    }

    const key = trimmed.slice(0, colonAt).trim();
    let value = trimmed.slice(colonAt + 1).trim();

    result[key] = parseValue(value);
  }

  return result;
}

/**
 * 把一个值转成合适的类型
 *
 * 只处理三种：
 *   - [a, b]  → 数组（tags 用）
 *   - true/false → 布尔（draft 用）
 *   - 其他 → 去掉引号的字符串
 */
function parseValue(value) {
  // 空值 → 空字符串（date 字段留空由上层判空）
  if (value === '') return '';

  // 数组：[Git, Windows] 或 ["Git", "Windows"]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s !== '');
  }

  // 布尔
  if (value === 'true') return true;
  if (value === 'false') return false;

  return stripQuotes(value);
}

function stripQuotes(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    // 双引号包裹：要把拼装时转义的 \" 和 \\ 还原回来
    // （buildFile 里 yamlString() 会做转义，这里必须做对应的反转义，
    //   否则带引号的内容会越存越多反斜杠 —— 首次实测就踩到了这个）
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    // 单引号在 YAML 里用两个单引号表示一个单引号
    return s.slice(1, -1).replace(/''/g, "'");
  }

  return s;
}

// ---------- 拼装 ----------

/**
 * 把 { data, body } 拼成一个完整的 .md 文件内容
 *
 * @param {object} data frontmatter 字段
 * @param {string} body 正文
 * @returns {string}
 * @throws {Error} 必填字段缺失或格式不对时抛出
 */
export function buildFile(data, body) {
  const problems = validate(data);
  if (problems.length > 0) {
    throw new Error('无法保存，有 ' + problems.length + ' 处问题：\n' + problems.join('\n'));
  }

  const fmLines = [];

  fmLines.push(`title: ${yamlString(data.title)}`);
  fmLines.push(`description: ${yamlString(data.description)}`);
  fmLines.push(`pubDate: ${data.pubDate}`);

  // 选填：有值才写
  if (data.updatedDate) {
    fmLines.push(`updatedDate: ${data.updatedDate}`);
  }
  fmLines.push(`category: ${yamlString(data.category)}`);

  // tags 永远写出来（空数组也写，便于人工查看）
  const tags = Array.isArray(data.tags) ? data.tags.filter((t) => t !== '') : [];
  fmLines.push(`tags: [${tags.join(', ')}]`);

  fmLines.push(`draft: ${data.draft === true ? 'true' : 'false'}`);

  // 三横线 + frontmatter + 三横线 + 空行 + 正文
  return `---\n${fmLines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

/**
 * 校验一份 frontmatter
 *
 * @returns {string[]} 问题清单，空数组 = 没问题
 */
export function validate(data) {
  const problems = [];

  // ---- 必填 ----
  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      problems.push(`· 缺少必填字段「${FIELD_LABELS[field] || field}」`);
    }
  }

  // ---- 日期格式 ----
  // ⚠️ 这是最容易出错、后果最严重的一项（构建会直接失败）
  for (const field of ['pubDate', 'updatedDate']) {
    const value = data[field];
    if (value === undefined || value === null || String(value).trim() === '') continue;

    if (!isValidDate(value)) {
      problems.push(
        `· 「${FIELD_LABELS[field] || field}」的格式不对：\`${value}\` —— ` +
          '必须是 YYYY-MM-DD（例如 2026-09-20）',
      );
    }
  }

  // ---- tags 类型 ----
  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    problems.push('· 「标签」必须是一组标签，不是一个字符串');
  }

  return problems;
}

const FIELD_LABELS = {
  title: '标题',
  description: '摘要',
  pubDate: '发布日期',
  category: '分类',
  updatedDate: '更新日期',
  tags: '标签',
  draft: '是否草稿',
};

/**
 * 判断是不是合法的 YYYY-MM-DD
 *
 * 不只是看形状 —— 还要防止 2026-02-31 这种"格式对但日期不存在"的值。
 */
export function isValidDate(value) {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  // 回读一遍：如果 Date 把 2 月 31 日"顺延"成 3 月 3 日，对比就会不等
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * 把字符串处理成 YAML 里安全的值
 *
 * 什么时候要加引号：
 *   - 以特殊符号开头（- ? : 等会被 YAML 当成语法）
 *   - 含冒号 + 空格、或 # （会被当成注释）
 *   - 看起来像数字/布尔（我们想让它保持字符串）
 */
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

  // 用双引号，并把内部的引号和反斜杠转义
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------- 正文安全检查 ----------

/**
 * 检查正文里有没有会让 frontmatter 边界混乱的东西
 *
 * 场景：正文里出现一行独立的 ---，本工具不会误解析（因为只认第一段的边界），
 * 但将来人工编辑时容易看花眼。所以只做提示，不阻止保存。
 */
export function checkBody(body) {
  const warnings = [];

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, i) => {
    if (line.trim() === '---') {
      warnings.push(`正文第 ${i + 1} 行是单独的三横线，可能与 frontmatter 分隔线混淆`);
    }
  });

  return warnings;
}

// ---------- 工具：从"今天"生成日期 ----------

/**
 * 返回今天的 YYYY-MM-DD（本地时区）
 *
 * ⚠️ 不能用 toISOString().slice(0,10) —— 那是 UTC，
 * 东八区晚上写的文章会被记成"昨天"。
 */
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
