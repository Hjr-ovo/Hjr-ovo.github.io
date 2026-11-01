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

// 文章 frontmatter 的校验规则。
//
// ⚠️ 外面套了一层 z.preprocess，作用是**字段别名**，不是改规则：
//   Obsidian 导出的笔记用 `date` / `explain`，站点要的是 `pubDate` / `description`。
//   这层在「校验之前」把别名映射成正式字段名，所以下面 schema 里
//   仍然只认 pubDate / description 两个真名，类型也和原来完全一样。
//   这样从 Obsidian 整篇复制过来的文章，不用手改字段名也能直接跑。
const postsSchema = z.object({
  // ---- 必填 ----
  title: z.string(),
  description: z.string(),
  pubDate: z.coerce.date(),
  // 分类：一篇文章可以属于多个分类（2026-10-18 从单值 category 改来）。
  // 2026-11-01 起**不再强制至少一个**：分类只是归类手段，不归类的文章
  // 照样该发，它只是不出现在任何分类页里。改成 default([]) 而不是去掉字段，
  // 是为了让模板里 `post.data.categories` 永远是个数组，少写空值判断。
  categories: z.array(z.string()).default([]),

  // ---- 选填 ----
  // updatedDate 不写就不显示（不是每篇文章都会更新）
  updatedDate: z.coerce.date().optional(),
  // 标签可以以后再加
  tags: z.array(z.string()).default([]),
  // draft: true 的文章不会出现在列表和页面里，方便"写了但先不发"
  draft: z.boolean().default(false),
});

const posts = defineCollection({
  // 文章存在 src/content/posts/ 下，一篇文章一个 .md 文件
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),

  schema: z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const data = /** @type {Record<string, unknown>} */ (raw);
    // 只在正式字段缺失时才用别名兜底，避免两边都写时以正式字段为准
    return {
      ...data,
      pubDate: data.pubDate ?? data.date ?? data.created,
      description: data.description ?? data.explain ?? data.summary,
    };
  }, postsSchema),
});

export const collections = { posts };
