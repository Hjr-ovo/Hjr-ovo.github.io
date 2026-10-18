// 内容集合的配置：定义"一篇文章应该长什么样"
//
// 这个文件的作用是告诉 Astro：
//   1. 文章放在哪个文件夹（loader）
//   2. 每篇文章开头的 frontmatter 必须有哪些字段（schema）
//
// ⚠️ 文件名必须是 src/content.config.ts（Astro 5+ 的规定），
//    写成 src/content/config.ts 会**静默失效** —— 不报错，但校验完全不生效。
//
// 字段清单见 搭建设计和过程/设计方案/架构设计.md 第五节。

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  // 文章存在 src/content/posts/ 下，一篇文章一个 .md 文件
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),

  schema: z.object({
    // ---- 必填 ----
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    // 分类：一篇文章可以属于多个分类（2026-10-18 从单值 category 改来）。
    // 至少留一个 —— 没有分类的文章在分类页里会成孤儿。
    // min(1) 而不是 default([])：空数组等于没分类，必须是作者有意为之，
    // 而"无意漏写"和"有意不放"要能区分开，所以不给默认值。
    categories: z.array(z.string()).min(1),

    // ---- 选填 ----
    // updatedDate 不写就不显示（不是每篇文章都会更新）
    updatedDate: z.coerce.date().optional(),
    // 标签可以以后再加
    tags: z.array(z.string()).default([]),
    // draft: true 的文章不会出现在列表和页面里，方便"写了但先不发"
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
