// remark 插件：让 Obsidian 导出的 Markdown 不用手改就能直接用。
//
// ── 解决什么问题 ───────────────────────────────────────────
// 从 Obsidian 整篇复制过来的文章，有三种写法站点不认识：
//
//   1. `==高亮==`   —— Obsidian 的荧光笔语法，Markdown 标准里没有。
//                      不改的话页面上会原样露出两个等号，很难看。
//   2. 用 `#` 做章节 —— Obsidian 笔记习惯从一级标题起；
//                      而站点页面顶部已经有一个 <h1> 当文章大标题了，
//                      正文里的 `#` 会让一页出现多个 h1，
//                      而且右侧目录只收二级/三级标题，这些章节会整个消失。
//   3. `> [!NOTE]`  —— Obsidian 的 Callout（提示框），标准 Markdown 里
//                      只是一段普通引用，页面上会原样显示 "[!NOTE]" 这串字符。
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
//   ③ `> [!NOTE]`（以及 TIP / WARNING / DANGER…）→ 带图标和配色的提示框：
//      <blockquote class="callout callout-note"> + 一个 .callout-title 标题行。
//      写法与 Obsidian 完全一致，可以自定义标题（`> [!WARNING] 注意这里`），
//      不认识的类型（`> [!FOO]`）保持原样的普通引用，不乱猜。
//      颜色和图标见 global.css 的「Callout」一节。
//
// ── 刻意没做的事 ───────────────────────────────────────────
//   · 代码块里的 `==`（比如 Java 的 `a == b`）不会被误伤 ——
//     代码块在 AST 里是独立的 code 节点，不是文本节点，天然隔离。
//   · 正文段落里的 `==` 比较运算符**会被**当成高亮（无法与荧光笔区分）。
//     技术文章里运算符一般写在代码块内，所以实际影响很小；
//     真要写在正文里，用反引号包一下（`==`）即可避开。
//   · Callout 的**折叠型**（`> [!NOTE]-` 收起 / `> [!NOTE]+` 展开）
//     目前只认标记、不实现折叠 —— 内容始终展开。真要做需要 <details>，
//     等有人用再说，别为想象中的需求加复杂度。
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

// ---------- ③ Callout ----------

// 类型别名 → 实际用的那一类。Obsidian 认 13 种，别名（hint / caution / error…）
// 都归到主类上，免得 CSS 里写四十个类。
const CALLOUT_ALIAS = {
  note: 'note',
  abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
  info: 'info', todo: 'todo',
  tip: 'tip', hint: 'tip', important: 'tip',
  success: 'success', check: 'success', done: 'success',
  question: 'question', help: 'question', faq: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning',
  failure: 'failure', fail: 'failure', missing: 'failure',
  danger: 'danger', error: 'danger',
  bug: 'bug', example: 'example',
  quote: 'quote', cite: 'quote',
};

// 没写自定义标题时显示的默认文案（与 Obsidian 的英文界面一致）
const CALLOUT_TITLE = {
  note: 'Note', abstract: 'Abstract', info: 'Info', todo: 'Todo', tip: 'Tip',
  success: 'Success', question: 'Question', warning: 'Warning',
  failure: 'Failure', danger: 'Danger', bug: 'Bug', example: 'Example', quote: 'Quote',
};

// 图标用路径 d 直接写死，不引图标库：一共十来个，装个依赖不值当。
// 都是 24×24 网格的线性图标（Lucide 风格），颜色由 CSS 的 currentColor 决定。
const CALLOUT_ICONS = {
  note: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  abstract: [
    'M8 4h2.4a2 2 0 0 1 3.2 0H16a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    'M9.5 11h5', 'M9.5 15h5',
  ],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 16v-5', 'M12 8h.01'],
  todo: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm8.5 12.2 2.3 2.3 4.7-4.7'],
  tip: [
    'M12 3a6 6 0 0 0-3.4 10.9c.5.4.9 1 .9 1.7v.4h5v-.4c0-.7.4-1.3.9-1.7A6 6 0 0 0 12 3Z',
    'M9.5 19h5', 'M10.5 22h3',
  ],
  success: ['M20 6 9 17l-5-5'],
  question: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M9.6 9.2a2.45 2.45 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.3',
    'M12 17h.01',
  ],
  warning: [
    'M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    'M12 9v5', 'M12 17.4h.01',
  ],
  failure: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm15 9-6 6', 'm9 9 6 6'],
  danger: ['M13 2 4 14h6l-1 8 9-12h-6l1-8Z'],
  bug: [
    'M12 8a5 5 0 0 1 5 5v1.5a5 5 0 0 1-10 0V13a5 5 0 0 1 5-5Z',
    'M12 8V5', 'M4 13h3', 'M17 13h3',
    'M9 5.6 6.5 4.2', 'M15 5.6 18.5 4.2', 'M8.6 18.8 7 21', 'M15.4 18.8 17 21',
  ],
  example: [
    'M8 6h13', 'M8 12h13', 'M8 18h13',
    'M3.6 6h.01', 'M3.6 12h.01', 'M3.6 18h.01',
  ],
  quote: ['M7 7h4v6c0 2.1-1.5 3.6-4 4.2', 'M16 7h4v6c0 2.1-1.5 3.6-4 4.2'],
};

/** mdast 里造一个 <svg class="callout-icon"><path d="…"/></svg> */
function makeIcon(paths) {
  return {
    type: 'calloutIcon',
    data: {
      hName: 'svg',
      hProperties: {
        className: ['callout-icon'],
        viewBox: '0 0 24 24',
        width: '16',
        height: '16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
    },
    children: paths.map((d) => ({
      type: 'calloutIconPath',
      data: { hName: 'path', hProperties: { d } },
      children: [],
    })),
  };
}

/** 标题行：图标 + 文字，整条用 flex 排（样式见 global.css） */
function makeTitle(kind, text) {
  return {
    type: 'calloutTitle',
    data: { hName: 'div', hProperties: { className: ['callout-title'] } },
    children: [makeIcon(CALLOUT_ICONS[kind] ?? CALLOUT_ICONS.note), { type: 'text', value: text }],
  };
}

// 引用块第一行：`[!NOTE]` 或 `[!NOTE] 自定义标题`（+/- 是折叠标记，先只识别不实现）
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

/**
 * 把一个 `> [!TYPE]` 开头的引用块改造成 Callout。
 * @returns {boolean} 是否真的改了（类型不认识就返回 false，保持原样）
 */
function transformCallout(bq) {
  const first = bq.children[0];
  if (!first || first.type !== 'paragraph') return false;

  const head = first.children[0];
  if (!head || head.type !== 'text') return false;

  const m = CALLOUT_RE.exec(head.value);
  if (!m) return false;

  const kind = CALLOUT_ALIAS[m[1].toLowerCase()];
  if (!kind) return false; // 不认识的类型：别自作主张

  // 标记后面可能直接跟标题（同一行），也可能是空的
  const lines = head.value.slice(m[0].length).split('\n');
  const inlineTitle = lines[0].trim();
  const rest = lines.slice(1).join('\n');

  // 把这一行从正文里摘掉；后面还有内容就留着，否则整段删掉（避免空 <p>）
  if (rest) head.value = rest;
  else first.children.shift();

  const stillHasContent = first.children.some((c) => c.type !== 'text' || c.value.trim() !== '');
  if (!stillHasContent) bq.children.shift();

  bq.data = bq.data ?? {};
  const prev = bq.data.hProperties ?? {};
  bq.data.hProperties = {
    ...prev,
    className: ['callout', `callout-${kind}`, ...(prev.className ?? [])],
  };

  bq.children.unshift(makeTitle(kind, inlineTitle || CALLOUT_TITLE[kind]));
  return true;
}

/** 遍历全文找引用块（先收齐再改，免得边遍历边插节点漏掉后面的） */
function applyCallouts(tree) {
  const blocks = [];
  (function collect(node) {
    if (node.type === 'blockquote') blocks.push(node);
    if (node.children) for (const child of node.children) collect(child);
  })(tree);

  for (const bq of blocks) transformCallout(bq);
}

export default function remarkObsidian() {
  return (tree) => {
    // ① 先处理高亮（要在标题降级之前也无所谓，两者互不影响）
    processNode(tree);

    // ② Callout：把 `> [!NOTE]` 变成提示框。
    //    放在高亮之后，这样提示框正文里的 `==高亮==` 已经处理好了。
    applyCallouts(tree);

    // ③ 标题降级：只要正文里出现 h1 就整体降一级。
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
