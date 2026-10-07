// @ts-check
import { defineConfig } from 'astro/config';

// 数学公式支持：
//   remark-math  —— 把 Markdown 里的 $...$ / $$...$$ 识别成数学节点
//   rehype-katex —— 把这些节点渲染成 HTML（配合下面引的 KaTeX 样式表显示）
// 不装这两个的话，公式会原样吐出一串 \sum_{i=1}^{n} 这样的裸符号。
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// https://astro.build/config
export default defineConfig({
  // 代码高亮主题。
  // Astro 内置 Shiki，默认用的是 `github-dark` —— 那是**深色**配色，
  // 放在我们这个浅色页面上会变成一块突兀的黑块，所以换成浅色主题。
  // 想看别的效果：https://shiki.style/themes
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },

    // 数学公式。两个插件缺一不可：
    //   remark 阶段：认出「这是数学」→ 交给后面
    //   rehype 阶段：变成真正的 HTML 结构
    // 顺序也不能反 —— remark 处理 Markdown，rehype 处理 HTML，是流水线的两段。
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
