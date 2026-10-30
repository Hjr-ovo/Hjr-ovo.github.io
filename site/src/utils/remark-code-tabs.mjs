// remark 插件：把「同一段逻辑的多种语言写法」合并成一个可切换的语言标签页。
//
// ── 作者怎么写 ─────────────────────────────────────────────
// 代码块的语言名后面加 `+tab`：
//
//   ```cpp+tab
//   ...
//   ```
//   ```java+tab
//   ...
//   ```
//   ```python+tab
//   ...
//   ```
//
// 规则：
//   · 连续的 +tab 代码块归为同一组
//   · 同一组里出现过的语言再次出现 → 自动开新的一组
//     （所以一篇里有多处多语言示例时，不用写任何分隔标记）
//   · 语言名不做限制，写 rust+tab 就有 Rust、go+tab 就有 Go，
//     新语言零成本，不用改这个文件
//
// ── 为什么必须放在 remark 阶段 ────────────────────────────
// Astro 的 Shiki 高亮注册在「用户 rehype 插件之前」
// （见 node_modules/@astrojs/markdown-remark/dist/index.js：先 use(rehypeShiki)
//  再循环 use(rehypePlugins)）。等自定义 rehype 插件跑的时候，代码块已经被
// 整块替换成高亮结果，原始 <pre><code> 结构拿不到了，没法再分组。
// remark 阶段拿到的是 Markdown AST，还没变成 HTML，此时包一层容器最干净。
//
// ── 产出的 HTML ───────────────────────────────────────────
//   <div class="code-tabs" data-tabs>
//     <div class="code-tab-panel" data-lang="cpp" data-label="C++">
//       <pre class="astro-code" …>…</pre>   ← Shiki 照常高亮
//     </div>
//     …
//   </div>
//
// 内层的 <pre> 是标准结构，Shiki 的 highlightCodeBlocks 只替换 pre 节点本身，
// 外层两个 div 完好存活 —— 这就是分组不会被冲掉的原因。

const TAB_SUFFIX = /\+tab$/;

// 语言代码 → 标签上显示的名字。
// 没收录的直接显示原名，所以「加语言」永远不用动这里。
const LABELS = {
  cpp: 'C++',
  'c++': 'C++',
  c: 'C',
  java: 'Java',
  python: 'Python',
  py: 'Python',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  csharp: 'C#',
  'c#': 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  sql: 'SQL',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  // 算法文章里常用的「不算真语言」的写法
  pseudo: '伪代码',
  pseudocode: '伪代码',
  text: '文本',
  plaintext: '文本',
};

function labelOf(lang) {
  return LABELS[lang.toLowerCase()] ?? lang;
}

function isTabCode(node) {
  return (
    node.type === 'code' &&
    typeof node.lang === 'string' &&
    TAB_SUFFIX.test(node.lang)
  );
}

/** 把一组 { node, lang } 包成 <div class="code-tabs"><div class="code-tab-panel">… */
function buildGroup(items) {
  return {
    type: 'codeTabs',
    // mdast 允许用 data.hName / hProperties 指定「这段在 HTML 里是什么标签、
    // 带什么属性」。这里是唯一能把自定义结构带进 HTML 的通道。
    data: {
      hName: 'div',
      hProperties: { className: ['code-tabs'], 'data-tabs': '' },
    },
    children: items.map(({ node, lang }) => ({
      type: 'codeTabPanel',
      data: {
        hName: 'div',
        hProperties: {
          className: ['code-tab-panel'],
          'data-lang': lang,
          'data-label': labelOf(lang),
        },
      },
      children: [
        // 关键：把 `cpp+tab` 改回 `cpp`，Shiki 才知道用哪套语法高亮。
        // 不改的话 Shiki 会当成不存在的语言，警告后回退成纯文本。
        { ...node, lang },
      ],
    })),
  };
}

export default function remarkCodeTabs() {
  return (tree) => {
    const out = [];
    let i = 0;

    while (i < tree.children.length) {
      if (!isTabCode(tree.children[i])) {
        out.push(tree.children[i]);
        i += 1;
        continue;
      }

      // 收一段连续的 +tab 代码块，并按「语言重复即分组」切开
      const groups = [];
      let current = null;

      while (i < tree.children.length && isTabCode(tree.children[i])) {
        const node = tree.children[i];
        const lang = node.lang.replace(TAB_SUFFIX, '');

        if (!current || current.seen.has(lang)) {
          current = { seen: new Set(), items: [] };
          groups.push(current);
        }
        current.seen.add(lang);
        current.items.push({ node, lang });
        i += 1;
      }

      for (const group of groups) {
        out.push(buildGroup(group.items));
      }
    }

    tree.children = out;
  };
}
