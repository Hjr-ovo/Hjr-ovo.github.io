// remark 插件：让 Obsidian 导出的 Markdown 不用手改就能直接用。
//
// ── 解决什么问题 ───────────────────────────────────────────
// 从 Obsidian 整篇复制过来的文章，有两种写法站点不认识：
//
//   1. `==高亮==`   —— Obsidian 的荧光笔语法，Markdown 标准里没有。
//                      不改的话页面上会原样露出两个等号，很难看。
//   2. 用 `#` 做章节 —— Obsidian 笔记习惯从一级标题起；
//                      而站点页面顶部已经有一个 <h1> 当文章大标题了，
//                      正文里的 `#` 会让一页出现多个 h1，
//                      而且右侧目录只收二级/三级标题，这些章节会整个消失。
//
// ── 做了什么 ───────────────────────────────────────────────
//   ① `==文字==` → <mark>文字</mark>
//      支持跨格式：`==**哈希冲突**==` 这种把粗体包在高亮里的写法也能正确转换
//      （这在 mdast 里其实是三个节点：文本 "==" + 粗体 + 文本 "=="，
//       所以要跨节点配对，不能只在单个文本节点里做字符串替换）
//   ② 正文里只要出现 h1，就把全文标题整体降一级
//      （# → ##、## → ### …），让章节回到目录里。
//      降级只在构建时作用于内存中的 AST，**不写回 .md 文件**，
//      所以原作者怎么写的还是怎么写的。
//
// ── 刻意没做的事 ───────────────────────────────────────────
//   · 代码块里的 `==`（比如 Java 的 `a == b`）不会被误伤 ——
//     代码块在 AST 里是独立的 code 节点，不是文本节点，天然隔离。
//   · 正文段落里的 `==` 比较运算符**会被**当成高亮（无法与荧光笔区分）。
//     技术文章里运算符一般写在代码块内，所以实际影响很小；
//     真要写在正文里，用反引号包一下（`==`）即可避开。
//
// ── 为什么放 remark 阶段 ──────────────────────────────────
// 和 remark-code-tabs.mjs 同一原因：Shiki 高亮跑在自定义 rehype 插件之前，
// 到 rehype 阶段代码块已被替换、文本结构也已经固化成 HTML 字符串了。

/** 有 children 的容器节点类型 —— 只在这些里面找 ==，不进代码 */
const CONTAINERS = new Set([
  'root',
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'emphasis',
  'strong',
  'link',
  'tableCell',
]);

/** 包装一层 <mark>。data.hName 是 mdast 指定 HTML 标签的唯一通道（同 code-tabs） */
function makeMark(children) {
  return {
    type: 'obsidianMark',
    data: { hName: 'mark' },
    children,
  };
}

/**
 * 在一个容器的 children 里，把成对的 == 包成 <mark>。
 * @returns 处理后的 children 数组
 */
function wrapHighlights(children) {
  const out = [];
  // 正在收集高亮内容的节点；null 表示当前不在高亮区间内
  let buffer = null;

  for (const child of children) {
    // 非文本节点（粗体、行内代码、链接…）不参与配对，只跟着状态走
    if (child.type !== 'text') {
      if (buffer) buffer.push(child);
      else out.push(child);
      continue;
    }

    const parts = child.value.split('==');
    for (let i = 0; i < parts.length; i += 1) {
      // 每遇到一个 == 就切换一次「是否在高亮内」
      if (i > 0) {
        if (buffer) {
          out.push(makeMark(buffer));
          buffer = null;
        } else {
          buffer = [];
        }
      }
      const text = parts[i];
      if (!text) continue;
      const node = { type: 'text', value: text };
      if (buffer) buffer.push(node);
      else out.push(node);
    }
  }

  // 等号没配对（`==` 只出现一次）：原样吐回去，不要吞掉内容
  if (buffer) {
    out.push({ type: 'text', value: '==' });
    out.push(...buffer);
  }

  return out;
}

/** 递归遍历，原地替换容器的 children */
function processNode(node) {
  if (!node.children) return;

  if (CONTAINERS.has(node.type)) {
    node.children = wrapHighlights(node.children);
  }
  // 替换后的新节点（mark、文本）也可能带子节点，继续往下走
  for (const child of node.children) {
    processNode(child);
  }
}

/** 收集所有标题的层级分布 */
function countHeadings(node, counts) {
  if (node.type === 'heading') {
    counts[node.depth] = (counts[node.depth] ?? 0) + 1;
  }
  if (node.children) {
    for (const child of node.children) countHeadings(child, counts);
  }
}

/** 全文标题整体降一级 */
function demote(node) {
  if (node.type === 'heading') {
    node.depth = Math.min(6, node.depth + 1);
  }
  if (node.children) {
    for (const child of node.children) demote(child);
  }
}

export default function remarkObsidian() {
  return (tree) => {
    // ① 先处理高亮（要在标题降级之前也无所谓，两者互不影响）
    processNode(tree);

    // ② 标题降级：只要正文里出现 h1 就整体降一级。
    //    站点页面顶部已有 <h1> 文章大标题，正文再出现 h1 本身就是多余的；
    //    而 Obsidian 笔记正是从 # 起头的。降级后章节会回到右侧目录。
    //    没有 h1 的文章（已经按站点规范写的）完全不动。
    const counts = {};
    countHeadings(tree, counts);
    if (counts[1]) {
      demote(tree);
    }
  };
}
