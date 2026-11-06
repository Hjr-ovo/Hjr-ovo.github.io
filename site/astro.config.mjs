// @ts-check
import { defineConfig } from 'astro/config';

// 数学公式支持：
//   remark-math  —— 把 Markdown 里的 $...$ / $$...$$ 识别成数学节点
//   rehype-katex —— 把这些节点渲染成 HTML（配合下面引的 KaTeX 样式表显示）
// 不装这两个的话，公式会原样吐出一串 \sum_{i=1}^{n} 这样的裸符号。
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// 多语言代码切换：把连续的 `xxx+tab` 代码块合并成可切换的语言标签页。
// 必须在 remark 阶段做 —— Shiki 高亮跑在自定义 rehype 插件之前，
// 到 rehype 时原始代码块已经被替换掉了（详见该文件顶部注释）。
import remarkCodeTabs from './src/utils/remark-code-tabs.mjs';

// Obsidian 格式适配：==高亮== → <mark>、正文 h1 整体降级（让章节进入右侧目录）。
// 为什么也在 remark 阶段：同 code-tabs，Shiki 高亮后会拿不到原始文本结构。
import remarkObsidian from './src/utils/remark-obsidian.mjs';

// 图片：给每张图补 loading="lazy" / decoding="async"，并可切换图床域名。
// 一篇文章十几张截图时，不懒加载就是十几个请求同时压在 GitHub 的 raw 域名上，
// 国内那一步特别慢。切换 CDN 只改文件顶部的 IMAGE_CDN 一行。
import rehypeImages from './src/utils/rehype-image.mjs';

// 表格套滚动容器：`<table>` 外面包一层 `.table-scroll`（见该文件顶部注释）。
// 表格自己做 overflow 会让列宽不撑满容器，右边留一大块空白。
import rehypeTableScroll from './src/utils/rehype-table-scroll.mjs';

// 文章改名后的「旧地址 → 新地址」对照表（见 技术架构.md 5.5.2）。
// 静态站没有服务端，改名会让旧链接直接 404；
// 这个表让 Astro 在构建时给每个旧地址生成一个跳转页，顶替那个位置。
// 表本身由博客后台工具在改名时自动维护，这里只负责读出来喂给 Astro。
import { loadRedirects } from './src/utils/redirects.mjs';

// https://astro.build/config
export default defineConfig({
  // 上线地址。GitHub Pages 的「用户站」占根域名（仓库名 = <用户名>.github.io），
  // 所以这里不带子路径，站点里那些写死的 /posts/、/about/ 链接才不用加前缀。
  // 现在还没用到它，但以后加 sitemap / canonical / RSS 都要靠它拼绝对地址，先定好省得忘。
  site: 'https://hjr-ovo.github.io',

  // 文章改名留下的旧地址，构建时自动生成跳转页。
  // 表为空时这里是 {}，Astro 不生成任何跳转页，无副作用。
  //
  // ⚠️ 表里的 key 必须是「已经不存在的文件名」：
  //   如果旧文件还在，跳转页会和真实文章页抢同一个地址（Astro 会警告并让跳转页胜出），
  //   所以只在改名（旧文件已消失）后追加，不要手工往里塞现存的文件名。
  redirects: loadRedirects(),

  // 代码高亮主题：浅色 / 深色各一套。
  // 写 `theme: 'github-light'` 是不行的 —— 那样深色模式下代码块会是一整块白底。
  // 用 `themes` 时 Shiki 会把两套配色都写成 CSS 变量（--shiki-light / --shiki-dark）
  // 挂在元素上，具体用哪套由 CSS 按当前主题决定（见 global.css 的 .astro-code 规则）。
  // 想看别的效果：https://shiki.style/themes
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },

    // 数学公式。两个插件缺一不可：
    //   remark 阶段：认出「这是数学」→ 交给后面
    //   rehype 阶段：变成真正的 HTML 结构
    // 顺序也不能反 —— remark 处理 Markdown，rehype 处理 HTML，是流水线的两段。
    remarkPlugins: [remarkMath, remarkObsidian, remarkCodeTabs],
    rehypePlugins: [rehypeTableScroll, rehypeKatex, rehypeImages],
  },
});
