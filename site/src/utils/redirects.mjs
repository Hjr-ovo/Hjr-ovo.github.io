// 读取「地址重定向表」，供 astro.config.mjs 在构建时注入。
//
// 背景（见 博客后台工具/技术架构.md 5.5.2）：
//   静态站没有服务端，改了名字 = 改了 URL = 旧链接失效。
//   解决办法是在构建时给每个旧地址生成一个跳转页，顶替那个位置。
//   这张表就记着「哪些旧地址该跳到哪儿」。
//
// 表里记三类地址（2026-10-14 起支持分类与标签）：
//   /posts/<文件名>        文章（改文件名会产生）
//   /categories/<分类名>   分类（改分类名会产生）
//   /tags/<标签名>         标签（改标签名会产生）
//
// 为什么单独放一个 json 而不是写死在 astro.config.mjs：
//   astro.config.mjs 是手写的代码，博客后台工具每次改名都去改它，
//   容易改坏、也容易跟手工编辑打架。数据归数据，代码归代码。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLE_PATH = path.join(__dirname, '..', 'data', 'redirects.json');

/**
 * 读出重定向映射，转换成 Astro `redirects` 配置要的格式。
 *
 * 表的 key / value 都是**完整路径**，直接透传给 Astro：
 *   { "/posts/old-name": "/posts/new-name/" }
 *
 * 用完整路径而不是只写文件名，是因为要同时容纳 /posts/、/categories/、/tags/
 * 三种地址；只写文件名的话就得靠猜前缀，早晚出错。
 *
 * @returns {Record<string, string>}
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

  for (const [from, to] of Object.entries(map)) {
    if (!from || !to) continue;

    // 写错的 key 直接让构建失败，不要静默跳过 ——
    // 跳过一个重定向，就等于让一个旧地址 404 而没人知道。
    if (!from.startsWith('/')) {
      throw new Error(
        `重定向表的 key 必须是完整路径（以 / 开头），实际是：「${from}」\n` +
          `文件：${TABLE_PATH}`,
      );
    }

    result[from] = to;
  }

  return result;
}

