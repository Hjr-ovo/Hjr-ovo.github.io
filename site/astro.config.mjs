// @ts-check
import { defineConfig } from 'astro/config';

// 数学公式支持：
//   remark-math  —— 把 Markdown 里的 $...$ / $$...$$ 识别成数学节点
//   rehype-katex —— 把这些节点渲染成 HTML（配合下面引的 KaTeX 样式表显示）
// 不装这两个的话，公式会原样吐出一串 \sum_{i=1}^{n} 这样的裸符号。
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// 文章改名后的「旧地址 → 新地址」对照表（见 技术架构.md 5.5.2）。
// 静态站没有服务端，改名会让旧链接直接 404；
// 这个表让 Astro 在构建时给每个旧地址生成一个跳转页，顶替那个位置。
// 表本身由博客管理工具在改名时自动维护，这里只负责读出来喂给 Astro。
import { loadRedirects } from './src/utils/redirects.mjs';

// https://astro.build/config
export default defineConfig({
  // 文章改名留下的旧地址，构建时自动生成跳转页。
  // 表为空时这里是 {}，Astro 不生成任何跳转页，无副作用。
  //
  // ⚠️ 表里的 key 必须是「已经不存在的文件名」：
  //   如果旧文件还在，跳转页会和真实文章页抢同一个地址（Astro 会警告并让跳转页胜出），
  //   所以只在改名（旧文件已消失）后追加，不要手工往里塞现存的文件名。
  redirects: loadRedirects(),

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
