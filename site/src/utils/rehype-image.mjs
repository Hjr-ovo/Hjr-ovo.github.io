// rehype 插件：给文章里的每一张图补上「懒加载 + 异步解码」，并可选地换图床域名。
//
// ── 为什么要有这个 ─────────────────────────────────────────
// Markdown 里写 `![](url)`，Astro 只会吐出光秃秃一个 <img src>。
// 一篇文章 9 张截图，浏览器打开就同时发 9 个请求，全部落在
// raw.githubusercontent.com 上 —— 国内这条链路本来就慢，等于整页白等。
//
// 补两个属性就够：
//   loading="lazy"      —— 视口外的图先不请求，滚到附近才拉。
//                          首屏只留 1~2 张，剩下的边读边下。
//   decoding="async"    —— 解码不占主线程，长文滚动不容易卡。
//
// ── 换图床域名（默认关） ───────────────────────────────────
// raw.githubusercontent.com 在国内经常被限速甚至连不上。
// jsDelivr 会缓存同一个 GitHub 仓库，国内一般快得多：
//   raw.githubusercontent.com/<用户>/<仓库>/<分支>/<路径>
//   → cdn.jsdelivr.net/gh/<用户>/<仓库>@<分支>/<路径>
// 改 IMAGE_CDN 这一行就能切换，文章里的原始链接一个字都不用动。
//
// ⚠️ 用 jsDelivr 的前提：仓库必须公开（Picture-host 已公开），
//    单个文件不超过 20 MB（现在最大 275 KB，没问题）。

/** 'off' = 原样用 raw.githubusercontent.com；'jsdelivr' = 换成 CDN 域名 */
export const IMAGE_CDN = 'off';

const CDN_HOSTS = {
  jsdelivr: 'cdn.jsdelivr.net',
};

/** 把 GitHub 原生链接换成 CDN 链接；不是 raw 链接的原样返回 */
function rewriteHost(src) {
  const host = CDN_HOSTS[IMAGE_CDN];
  if (!host) return src;

  const m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(src);
  if (!m) return src;

  const [, owner, repo, branch, path] = m;
  return `https://${host}/gh/${owner}/${repo}@${branch}/${path}`;
}

function walk(node) {
  if (node.tagName === 'img' && node.properties) {
    const p = node.properties;
    if (typeof p.src === 'string') p.src = rewriteHost(p.src);
    // 作者自己写了 loading 就不覆盖（rare，但别抢行）
    if (p.loading === undefined) p.loading = 'lazy';
    if (p.decoding === undefined) p.decoding = 'async';
  }
  if (node.children) for (const child of node.children) walk(child);
}

export default function rehypeImages() {
  return (tree) => {
    walk(tree);
  };
}
