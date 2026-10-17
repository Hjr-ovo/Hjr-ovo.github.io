// 相关文章推荐
//
// 规则刻意做得简单、可预测：只看「标签重合」和「同分类」两件事。
//   - 每重合一个标签 +3 分
//   - 同一个分类 +2 分（分类比标签粗，所以权重低一点）
// 分数相同时，发布时间更新的排前面。
//
// 为什么不引入「正文相似度」之类的高级算法：
//   博客规模只有几十篇，标签本身就是作者手工打的语义标记，
//   比任何自动相似度都准；等文章过百再谈优化也不迟。
//
// 分数为 0 的不进「相关文章」—— 与其硬凑三篇无关文章，不如换一个名头。
// 一篇文章算不出任何交集时，由调用方（文章页）退回「继续阅读」列最新几篇。

import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;

const WEIGHT_SHARED_TAG = 3;
const WEIGHT_SAME_CATEGORY = 2;

export function findRelated(current: Post, all: Post[], limit = 3): Post[] {
  return all
    .filter((post) => post.id !== current.id)
    .map((post) => {
      const sharedTags = post.data.tags.filter((tag) =>
        current.data.tags.includes(tag),
      ).length;
      const sameCategory = post.data.category === current.data.category ? 1 : 0;

      return {
        post,
        score: sharedTags * WEIGHT_SHARED_TAG + sameCategory * WEIGHT_SAME_CATEGORY,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf(),
    )
    .slice(0, limit)
    .map((item) => item.post);
}
