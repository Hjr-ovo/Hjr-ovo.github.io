/**
 * 给正文表格套一层滚动容器（2026-11-06）
 *
 * 为什么要有这层 div：
 *   原来为了「窄屏不撑破版面」，直接把 `<table>` 设成 `display: block; overflow-x: auto`。
 *   代价是表格不再按表格布局撑满容器 —— 内部那个匿名表格盒按内容宽算，
 *   元素盒是 100%（824px）而列加起来只有 400px 出头，右边一大片空白。
 *   以前只是难看，加了外圈绿框之后那块空白被框进去了，看着像表格画歪了。
 *
 *   正确分工：横向滚动交给外层 div，表格自己保持 `display: table; width: 100%` ——
 *   列宽按比例撑满，内容太宽时由外层横滚，版面照样不破。
 *
 * 放在 rehype 阶段而不是 remark：这里树已经是 HTML，认 `table` 元素比在 mdast 里
 * 造容器节点稳（mdast 没有通用的 div 节点，拿 paragraph 顶替会被 to-hast 报警）。
 */
const WRAP_CLASS = 'table-scroll';

const wrapTables = (node) => {
  if (!Array.isArray(node.children)) return;
  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child.type === 'element' && child.tagName === 'table') {
      node.children[i] = {
        type: 'element',
        tagName: 'div',
        properties: { className: [WRAP_CLASS] },
        children: [child],
      };
      // 不再往里递归：已经套好了，里面的东西原样交给渲染器
      continue;
    }
    wrapTables(child);
  }
};

export default function rehypeTableScroll() {
  return (tree) => {
    wrapTables(tree);
  };
}
