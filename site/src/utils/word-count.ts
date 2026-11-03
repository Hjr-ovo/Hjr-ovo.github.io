// 字数统计
//
// 口径（很重要，写清楚免得以后自己都说不清）：
//   1. 汉字、日文假名按「字」算，一个字符算 1；
//   2. 英文、数字按「词」算，`requestAnimationFrame` 算 1 个词，不是 19 个；
//   3. **不计代码** —— 围栏代码块、行内代码整段跳过。
//      技术文的代码往往比正文还长，算进去只会让「这篇有多长」完全失真；
//   4. 不计公式、图片、链接地址；链接只保留可读的文字部分。
//
// 为什么不写成「按字符数算」：中文里 1 个字符差不多等于 1 个字，但英文
// 一个词平均五六个字符，两种语言混排时字符数会让英文偏重。按上面口径，
// 中英文混排的文章读起来才和数字对得上。
//
// 为什么不做「约 X 分钟读完」：那个得先假设阅读速度（中文一般按 300-500 字/分），
// 假设一变结论就变，之前做过一版就是因为「感觉不准」被撤掉的（2026-11-02）。
// 字数是可以数的客观量，不依赖任何假设。

// 汉字（基本区 + 扩展 A）+ 日文假名。扩展 B 以后的字在技术文中基本不出现，不纳入
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;

/**
 * 估算一段 Markdown 的字数（不含代码）。
 * @param markdown 文章正文的原始 Markdown（不含 frontmatter）
 */
export function countWords(markdown: string): number {
  const text = markdown
    // 顺序有讲究：先干掉代码块，否则块里的 `$` `#` 会被后面的规则误伤
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    // 行内代码：单反引号成对，且不跨行
    .replace(/`[^`\n]*`/g, ' ')
    // 块级公式与行内公式：里面有大量字母，算进去等于把符号当文章
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    // HTML 标签（<br>、<details> 之类）
    .replace(/<[^>]+>/g, ' ')
    // 图片整体丢掉；链接只留方括号里的文字
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 裸链接
    .replace(/https?:\/\/\S+/g, ' ')
    // Obsidian 的 callout 标记 `[!NOTE]`，正文里不该算成单词
    .replace(/\[![A-Za-z]+\][+-]?/g, ' ')
    // 脚注引用 [^1]、锚点 {#id}
    .replace(/\[\^[^\]]*\]/g, ' ')
    .replace(/\{#[^}]*\}/g, ' ')
    // 行首的 Markdown 记号：标题 #、引用 >、列表 -/*/+、有序列表 1.
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, ' ')
    // 表格分隔行 |---|:--:|---| 与水平线
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    // 强调与删除线记号（保留里面的文字）
    .replace(/[*_~]{1,3}/g, '');

  const cjkCount = (text.match(new RegExp(CJK.source, 'g')) ?? []).length;
  // 汉字先换成空格，剩下的按「词」数，避免中英混排时重复计数
  const rest = text.replace(new RegExp(CJK.source, 'g'), ' ');
  const wordCount = (rest.match(/[A-Za-z0-9][A-Za-z0-9'’._-]*/g) ?? []).length;

  return cjkCount + wordCount;
}

/** 给页面用的展示格式：1,234 这种带千分位的写法 */
export function formatWords(count: number): string {
  return new Intl.NumberFormat('zh-CN').format(count);
}

/**
 * 给一批文章条目补上两个字段，供列表 / 卡片直接渲染：
 *   words     —— 原始数字，需要排序或参与计算时用
 *   wordLabel —— 拼好的「195 字」，正文为空时是空串（模板里当 falsy 用）
 *
 * 为什么把格式化也放进这个函数：卡片有六处（首页、归档、分类、标签、
 * 相关文章、搜索），每处都写一遍 `countWords(...) > 0 ? ...` 迟早写岔，
 * 只在 build 时算一次，随条目一起传下去最省事。
 */
export function withWordCount<T extends { body?: string }>(
  entries: T[],
): (T & { words: number; wordLabel: string })[] {
  return entries.map((entry) => {
    const words = countWords(entry.body ?? '');
    return {
      ...entry,
      words,
      wordLabel: words > 0 ? `${formatWords(words)} 字` : '',
    };
  });
}
