---
title: Astro 7 填 remarkPlugins 构建报错：默认 Markdown 处理器已换成 Sätteri
description: astro.config.mjs 里一写 remarkPlugins 或 rehypePlugins，构建直接失败，报错让你补装 @astrojs/markdown-remark。记录 Astro 7 把默认处理器从 unified 换成 Sätteri 这个 breaking change，以及同场踩到的 npm 挂死、KaTeX 样式表漏引两个坑。
pubDate: 2026-10-17
categories: [开发工具]
tags: [Astro, Markdown, 踩坑]
---

> **时效说明**：本文写于 2026-10-17，基于 Astro 7.3.3。Astro 迭代很快，
> 等你看到这篇文章时版本可能又变了——**报错信息本身永远是最准的**，以它为准。

## 环境

- Windows 11
- Node.js v24.15.0 / npm 11.12.1
- Astro 7.3.3（`astro@^7.3.3`）
- 目标：给站点加数学公式支持（`remark-math` + `rehype-katex`）

## 现象

在 `astro.config.mjs` 里按网上教程的写法填了 Markdown 插件：

```js
export default defineConfig({
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
```

`npm run build` 直接失败：

```text
`markdown.remarkPlugins`, `markdown.rehypePlugins`, and `markdown.remarkRehype` run on the
`unified` processor from `@astrojs/markdown-remark`, which is no longer installed by default
now that Sätteri is the default Markdown processor.

Install it with:
  npm install @astrojs/markdown-remark
```

## 先说结论

**不是配置写错了，是 Astro 7 换了默认的 Markdown 处理器。**

Astro 7 之前，Markdown 解析走的是 `unified` 那套流水线（remark/rehype 插件生态都建立在它上面），`@astrojs/markdown-remark` 这个包是**默认装好的**，所以教程里填 `remarkPlugins` 从来不用额外装东西。

Astro 7 把默认处理器换成了 **Sätteri**，不再默认带 `@astrojs/markdown-remark`。
你照旧教程写 `remarkPlugins`，它找不到那套流水线，构建就挂了。

**修复只有一步：把那个包装回去。**

```bash
npm install @astrojs/markdown-remark
```

`astro.config.mjs` 的写法**一个字都不用改**。补装之后同样的配置就能构建通过。

## 定位过程

这次没绕弯，因为报错信息写得非常清楚：它直接告诉你缺哪个包、该怎么装。

真正值得记的是**怎么理解这条报错**：

1. 报错说某个包「no longer installed by default」——这是**版本升级的信号**，
   说明你的写法停留在旧版本的默认行为上
2. 它让你装的是 `@astrojs/markdown-remark`，注意这个包名带 `@astrojs/` 前缀，
   是 Astro 官方的集成包，不是第三方野生插件
3. **先照它说的补装，别急着改写法**。很多人看到报错就怀疑「是不是 Astro 7 不支持
   remark 插件了」，于是去翻迁移文档找新写法——其实旧写法人家还支持，
   只是不再默认附带那条流水线

## 顺带踩到的第二个坑：npm 官方源挂死

补装时直接 `npm install @astrojs/markdown-remark remark-math rehype-katex katex`，
跑了 **5 分 29 秒毫无进展**，`node_modules` 里连目录都没建出来。

判断和修复都很快：

- `npm config get registry` 确认走的是官方源 `https://registry.npmjs.org/`
- 国内访问官方源极慢，这是老问题（这次已经不是第一次踩）
- 换国内镜像 **5 秒装完 53 个包**：

```bash
npm_config_registry=https://registry.npmmirror.com npm install @astrojs/markdown-remark
```

> **规矩**：`npm install` 超过 60 秒没有任何输出，直接中断换镜像，别硬等。
> 等的每一分钟都是纯亏。

## 顺带踩到的第三个坑：构建成功，但公式是歪的

补装、换源之后构建通过了，页面上的公式却长这样：

- 分数线、根号、上下标的位置全乱
- 退化成一堆「歪斜的普通文字」

**而构建全程一声不吭，退出码还是 0。**

根因：`rehype-katex` 只负责把数学节点转换成带 class 的 HTML **结构**，
这些 class 长什么样（字号、间距、字体），全靠使用者自己引 KaTeX 的样式表。
包安了、插件配了，但 `katex.min.css` 没引，就是这个下场。

修复：在布局文件里显式引入，并且**放在自己的全局样式之后**，
这样你自己的覆盖规则才有优先级：

```js
import '../styles/global.css';
import 'katex/dist/katex.min.css';
```

这个坑最值得记的一点：**「构建成功」不等于「看起来对」**。
涉及视觉效果的改动，构建通过只是及格线，必须实际渲染看一眼。

## 沉淀下来的规则

1. **框架报错说某个包「不再默认安装」，是版本升级的信号**——照它说的补装即可，
   不要急着改自己的写法
2. **npm install 超过 60 秒没输出就换国内镜像**（`registry.npmmirror.com`），别硬等
3. **「构建成功」不等于「看起来对」**——漏引样式表这类问题构建完全不报错，
   视觉效果必须实际渲染验证

---

*本文基于 2026-10-07 的一次真实排查（当时为了给博客加数学公式支持连撞三堵墙），
2026-10-17 整理成文。所有命令和版本号都经过实际验证。*
