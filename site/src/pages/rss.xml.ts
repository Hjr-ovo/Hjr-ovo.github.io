// RSS 订阅源：/rss.xml
//
// 为什么要有这个：博客收录站（如 chinese-independent-blogs）和各类阅读器
// 都靠 RSS 判断「这个站还活着、多久更一次」，没有它就收录不进去。
//
// 为什么不用官方的 @astrojs/rss：那个包只是把这几十行包了一层（拼 XML + 转义），
// 而本项目装依赖每次都卡在网络上（见 BUG-002 / BUG-013）。
// 这里就一个 GET，自己拼反而更稳、也不多一个依赖。
//
// ⚠️ 改站点地址时不用动这里：地址从 astro.config.mjs 的 site 读（import.meta.env.SITE），
//    只有拿不到时才退回下面写死的那个。

import { getCollection } from 'astro:content';
import { SITE } from '../consts';

/** 取站点根地址，去掉结尾斜杠，方便后面统一用 `${BASE}/xxx` 拼 */
const BASE = (import.meta.env.SITE ?? 'https://hjr-ovo.github.io').replace(/\/+$/, '');

/**
 * XML 转义。
 * 标题、摘要里随时可能出现 & < > —— 比如「A & B」「用 <script> 试了一下」，
 * 不转义整份 XML 就坏了，阅读器直接解析失败（表现为"订阅源无效"）。
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  // 和首页、归档页同一套规则：过滤草稿，按发布日期倒序。
  // 集合取出来的顺序不确定，不排的话每次构建顺序都可能变（RSS 会跟着乱跳）。
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const items = posts
    .map((post) => {
      // 文章页地址就是 /posts/<文件名>/，和站内其它地方保持一致
      const url = `${BASE}/posts/${post.id}/`;
      // 分类和标签都塞进 <category>：阅读器能拿来做筛选，
      // 收录站抓 RSS 时也能读到这个站都写些什么
      const categories = [...post.data.categories, ...post.data.tags]
        .map((name) => `      <category>${escapeXml(name)}</category>`)
        .join('\n');

      return [
        '    <item>',
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${url}</link>`,
        // guid 用文章地址本身：地址不变就不会被判成新文章，
        // 读者那边也不会因为我改了标题就重复收到一遍
        `      <guid isPermaLink="true">${url}</guid>`,
        // RFC 822 格式（Sun, 02 Nov 2026 08:00:00 GMT），RSS 2.0 规定的写法
        `      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.data.description)}</description>`,
        categories,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.title)}</title>
    <link>${BASE}/</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${BASE}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      // 必须是 xml 类型：浏览器直接打开时才会显示成源码而不是当文件下载
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
