// 地址重定向表：记录「旧地址 → 新地址」
//
// 为什么需要（见 ../技术架构.md 5.5.2）：
//   静态站没有服务端，改了名字 = 改了 URL = 旧地址直接 404。
//   这张表让 Astro 在构建时给每个旧地址生成一个跳转页，顶替那个位置。
//
// 表里同时装三类地址：
//   /posts/<文件名>        文章改名时写
//   /categories/<分类名>   分类改名时写
//   /tags/<标签名>         标签改名时写
//
// 单独成一个模块（2026-10-14 从 posts.mjs 抽出来）：
//   重定向表是「文章 / 分类 / 标签」共用的设施，放在 posts.mjs 里
//   会让 taxonomy.mjs 为了一个写表动作去依赖整个文章模块。

import fs from 'node:fs/promises';
import path from 'node:path';

import { REDIRECTS_FILE } from './config.mjs';

/**
 * 往重定向表里追加一条「旧地址 → 新地址」
 *
 * 表结构（site/src/data/redirects.json）：
 *   { "redirects": { "/posts/old-name": "/posts/new-name/" } }
 *
 * 边界情况与处理：
 *   · 表不存在      → 建一个新的
 *   · 表内容坏了    → 报错，不覆盖（宁可让用户看到，也不静默丢掉已有记录）
 *   · 会形成跳转链  → 自动拉直（见下）
 *
 * @param {string} fromPath 旧地址，如 /posts/old-name
 * @param {string} toPath   新地址，如 /posts/new-name/
 */
export async function addRedirect(fromPath, toPath) {
  const table = await readRedirectTable();

  // ---- 顺着已有记录往下追，拿到最终地址 ----
  // 场景：先有 B→C，现在又要写 A→B。若直接写 A→B，访问者会 A→B→C 跳两次。
  // 每多一跳都损耗链接权重（搜索引擎跟到第 5 跳就放弃），所以这里一次追到底。
  let finalTarget = toPath;
  const seen = new Set();
  while (table.redirects[finalTarget] && !seen.has(finalTarget)) {
    seen.add(finalTarget);
    finalTarget = table.redirects[finalTarget];
  }

  table.redirects[fromPath] = finalTarget;

  // ---- 反方向也拉直一次 ----
  // 场景：先有 A→B，现在写 B→C。此时表里 A 还指着 B，要一并改到 C。
  //
  // ⚠️ 分类/标签的合并会一次写两条（旧名→新名、以及可能存在的 旧名变体→新名），
  //    这个循环保证先写的那条也会被拉到最终地址。
  for (const [key, value] of Object.entries(table.redirects)) {
    if (value === fromPath && key !== fromPath) {
      table.redirects[key] = finalTarget;
    }
  }

  await writeRedirectTable(table);
}

/**
 * 批量写入多条重定向（分类/标签合并时会用到）
 *
 * 比连续调用 addRedirect 更好的地方：只读写文件一次，
 * 且多条之间也会互相拉直（不会出现 A→B 而 B 同时→C 的中转链）。
 *
 * @param {Array<{from: string, to: string}>} pairs
 */
export async function addRedirects(pairs) {
  if (!pairs || pairs.length === 0) return;

  const table = await readRedirectTable();

  // 先把所有新条目塞进去
  for (const { from, to } of pairs) {
    if (from && to) table.redirects[from] = to;
  }

  // 再统一拉直：顺着链一路追到终点，直到整张表不再有中转
  for (const from of Object.keys(table.redirects)) {
    let cur = table.redirects[from];
    const seen = new Set([from]);
    while (table.redirects[cur] && !seen.has(cur)) {
      seen.add(cur);
      cur = table.redirects[cur];
    }
    table.redirects[from] = cur;
  }

  await writeRedirectTable(table);
}

// ---------- 内部 ----------

async function writeRedirectTable(table) {
  // 先写临时文件再改名 —— 避免写到一半断电留下半个文件（跟 updatePost 同一套做法）
  const tmpPath = REDIRECTS_FILE + '.writing';
  await fs.mkdir(path.dirname(REDIRECTS_FILE), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(table, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, REDIRECTS_FILE);
}

/**
 * 读重定向表；不存在就返回一个空的
 */
async function readRedirectTable() {
  let raw;
  try {
    raw = await fs.readFile(REDIRECTS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ...EMPTY_TABLE_TEMPLATE, redirects: {} };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `重定向表内容不是合法 JSON，没有改动它：\n${REDIRECTS_FILE}\n` +
        '请手工检查这个文件（多半是多了或少了一个逗号）。',
    );
  }

  if (!parsed.redirects || typeof parsed.redirects !== 'object') {
    parsed.redirects = {};
  }

  return parsed;
}

// 表不存在时用的模板：把「这文件是干嘛的」直接写在文件里，
// 免得半年后打开看见一个空 json 不知道能不能删
const EMPTY_TABLE_TEMPLATE = {
  _说明: '地址变更对照表：某个地址改了之后，旧地址该跳到哪儿。由博客管理工具在改名/合并时自动追加，一般不用手改。',
  _格式: '键和值都是完整路径。例如 "/posts/old-name": "/posts/new-name/"，"/categories/旧分类": "/categories/新分类/"',
  _为什么需要: '静态站没有服务端，旧地址在文件消失后会直接 404。这张表让构建时自动在那个位置生成一个跳转页。',
};
