// 读取「文章改名重定向表」，供 astro.config.mjs 在构建时注入。
//
// 背景（见 博客管理工具/技术架构.md 5.5.2）：
//   静态站没有服务端，文章改名 = 改 URL = 旧链接失效。
//   解决办法是在构建时给每个旧地址生成一个跳转页，顶替那个位置。
//   这张表就记着「哪些旧地址该跳到哪儿」。
//
// 为什么单独放一个 json 而不是写死在 astro.config.mjs：
//   astro.config.mjs 是手写的代码，博客管理工具每次改名都去改它，
//   容易改坏、也容易跟手工编辑打架。数据归数据，代码归代码。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLE_PATH = path.join(__dirname, '..', 'data', 'redirects.json');

/**
 * 读出重定向映射，转换成 Astro `redirects` 配置要的格式。
 *
 * @returns {Record<string, string>} 形如 { '/posts/old-name': '/posts/new-name/' }
 */
export function loadRedirects() {
  let raw;

  try {
    raw = fs.readFileSync(TABLE_PATH, 'utf8');
  } catch (err) {
    // 表不存在不算错误 —— 一个从没改过名的站本来就不需要重定向
    if (err.code === 'ENOENT') return {};
    throw err;
  }

  const parsed = JSON.parse(raw);
  const map = parsed.redirects || {};

  /** @type {Record<string, string>} */
  const result = {};

  for (const [oldSlug, newSlug] of Object.entries(map)) {
    if (!oldSlug || !newSlug) continue;
    result[`/posts/${oldSlug}`] = `/posts/${newSlug}/`;
  }

  return result;
}
