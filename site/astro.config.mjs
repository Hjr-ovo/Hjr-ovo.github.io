// @ts-check
import { defineConfig } from 'astro/config';

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
  },
});
