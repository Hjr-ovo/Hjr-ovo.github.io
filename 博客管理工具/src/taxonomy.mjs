// 分类与标签：统计、改名、合并
//
// 为什么单独一个模块（2026-10-14 新增）：
//   站点新增了分类页（/categories/）和标签页（/tags/）以后，
//   「改一个分类名」就不再只是改个字段 —— 分类名和标签名会**直接进 URL**，
//   改名等于改地址，旧分类页会失效，必须配套写重定向。
//
//   这个模块把「统计」和「改名/合并」两件事收在一起，
//   让 server.mjs 不必关心这些细节。
//
// ⚠️ 中文名会进 URL：/categories/计算机网络/
//   浏览器访问时自动编码成 %E8%AE%A1…，Astro 生成页面时也会正确编码。
//   这条链路 2026-10-14 实测过，不用自己处理转义。

import fs from 'node:fs/promises';
import path from 'node:path';

import { POSTS_DIR, BACKUP_DIR, CATEGORY_URL_PREFIX, TAG_URL_PREFIX } from './config.mjs';
import { parseFrontmatter, buildFile } from './frontmatter.mjs';
import { addRedirects } from './redirects.mjs';

// 名字里不允许出现的字符：
//   逗号、方括号 —— 会被 frontmatter 的数组写法 `tags: [a, b]` 吃掉，存进去就变形
//   / \ # ? % & —— 会破坏 URL 结构（分类名和标签名是要进 URL 的）
//   换行、制表符 —— 会把 frontmatter 的一行拆成两行
const FORBIDDEN_IN_NAME = /[/\\#?%&[\],，\r\n\t]/;

// ---------- 读全部文章 ----------

/**
 * 把文章目录整个读进内存
 *
 * 为什么一次性全读：统计和改名都要遍历所有文章，
 * 逐个文件反复读盘没必要（文章量很小，几十篇也就几十 KB）。
 * 读不了的（格式坏）不中断流程，标出来让界面提示。
 */
async function readAllPosts() {
  await fs.mkdir(POSTS_DIR, { recursive: true });

  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
  const posts = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(md|mdx)$/i.test(entry.name)) continue;
    if (entry.name.startsWith('_')) continue; // 下划线开头是临时文件

    const slug = entry.name.replace(/\.(md|mdx)$/i, '');
    const filePath = path.join(POSTS_DIR, entry.name);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const { data, body } = parseFrontmatter(raw);

      posts.push({
        slug,
        fileName: entry.name,
        filePath,
        data,
        body,
        parseOk: true,
      });
    } catch (err) {
      posts.push({
        slug,
        fileName: entry.name,
        filePath,
        data: null,
        body: '',
        parseOk: false,
        parseError: String(err.message || err),
      });
    }
  }

  return posts;
}

// ---------- 统计 ----------

/**
 * 统计站内用到的所有分类和标签
 *
 * @returns {Promise<{
 *   categories: Array<{name: string, count: number, draftCount: number, slugs: string[]}>,
 *   tags: Array<{name: string, count: number, draftCount: number, slugs: string[]}>,
 *   postCount: number,
 *   draftCount: number,
 *   unparsed: Array<{slug: string, error: string}>,
 * }>}
 */
export async function listTaxonomy() {
  const posts = await readAllPosts();

  const categoryMap = new Map();
  const tagMap = new Map();
  const unparsed = [];

  let draftCount = 0;

  for (const post of posts) {
    if (!post.parseOk) {
      unparsed.push({ slug: post.slug, error: post.parseError });
      continue;
    }

    const isDraft = post.data.draft === true;
    if (isDraft) draftCount++;

    // 分类：一篇文章有且只有一个
    const category = String(post.data.category || '').trim();
    if (category) bump(categoryMap, category, post.slug, isDraft);

    // 标签：可以没有，可以多个。同一个标签在一篇里重复只算一次。
    const tags = Array.isArray(post.data.tags) ? post.data.tags : [];
    const uniqueTags = new Set(
      tags.map((t) => String(t).trim()).filter((t) => t !== ''),
    );
    for (const tag of uniqueTags) bump(tagMap, tag, post.slug, isDraft);
  }

  return {
    categories: toSortedList(categoryMap),
    tags: toSortedList(tagMap),
    postCount: posts.length,
    draftCount,
    unparsed,
  };
}

function bump(map, name, slug, isDraft) {
  if (!map.has(name)) {
    map.set(name, { name, count: 0, draftCount: 0, slugs: [] });
  }
  const entry = map.get(name);
  entry.count++;
  if (isDraft) entry.draftCount++;
  entry.slugs.push(slug);
}

// 排序：文章多的在前；一样多按名字排，保证每次看到顺序一致
function toSortedList(map) {
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'),
  );
}

// ---------- 改名 / 合并 ----------

/**
 * 把一个分类名或标签名改成另一个（新名字已存在时，效果就是合并）
 *
 * 合并和改名是同一个动作：把 A 全部改成 B。
 * 如果 B 本来就存在 → 两组文章并到一起（合并）；
 * 如果 B 不存在 → 就是单纯改名。
 *
 * @param {object} params
 * @param {'category'|'tag'} params.kind
 * @param {string} params.from 旧名字
 * @param {string} params.to   新名字
 * @param {boolean} [params.dryRun] 只算不写，用于界面预览
 */
export async function renameTaxonomy({ kind, from, to, dryRun = false }) {
  const isCategory = kind === 'category';
  if (!isCategory && kind !== 'tag') {
    throw new Error('类型只能是 category（分类）或 tag（标签）');
  }

  const label = isCategory ? '分类' : '标签';
  const fromName = String(from || '').trim();
  const toName = String(to || '').trim();

  // ---- 参数校验 ----
  if (!fromName) throw new Error(`旧${label}名不能为空`);
  if (!toName) throw new Error(`新${label}名不能为空`);
  if (fromName === toName) throw new Error('新旧名字一样，不需要改');

  if (FORBIDDEN_IN_NAME.test(toName)) {
    throw new Error(
      `${label}名里不能有这些字符：逗号、方括号、斜杠、# ? % &、换行。\n` +
        `（逗号和方括号会被 frontmatter 的数组写法吃掉，斜杠等会被 URL 当成路径分隔）`,
    );
  }

  const posts = await readAllPosts();

  // ---- 找出受影响的文章 ----
  const affected = [];
  for (const post of posts) {
    if (!post.parseOk) continue;

    if (isCategory) {
      if (String(post.data.category || '').trim() === fromName) affected.push(post);
    } else {
      const tags = (Array.isArray(post.data.tags) ? post.data.tags : []).map((t) =>
        String(t).trim(),
      );
      if (tags.includes(fromName)) affected.push(post);
    }
  }

  if (affected.length === 0) {
    throw new Error(`没有文章在用这个${label}：「${fromName}」`);
  }

  // ---- 目标名是否已存在（决定这次是"改名"还是"合并"）----
  const allNames = new Set();
  for (const post of posts) {
    if (!post.parseOk) continue;
    if (isCategory) {
      const c = String(post.data.category || '').trim();
      if (c) allNames.add(c);
    } else {
      for (const t of post.data.tags || []) {
        const s = String(t).trim();
        if (s) allNames.add(s);
      }
    }
  }
  const isMerge = allNames.has(toName);

  const prefix = isCategory ? CATEGORY_URL_PREFIX : TAG_URL_PREFIX;

  const summary = {
    kind,
    label,
    from: fromName,
    to: toName,
    isMerge,
    affectedCount: affected.length,
    affected: affected.map((p) => ({ slug: p.slug, title: String(p.data.title || '') })),
    oldUrl: `${prefix}${fromName}/`,
    newUrl: `${prefix}${toName}/`,
    backupDir: BACKUP_DIR,
  };

  // 预览模式到此为止，不碰任何文件
  if (dryRun) return summary;

  // ---- ① 备份 + 改写 ----
  // 先全部备份，再逐篇改写：万一写到一半出问题，至少每篇的原文都还在
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const stamp = timestamp();
  const changed = [];
  const failed = [];

  for (const post of affected) {
    try {
      // 备份（原名里带上后缀，和删除/改名的备份放一起，但一眼能区分）
      const backupPath = path.join(
        BACKUP_DIR,
        `${stamp}__taxonomy__${post.fileName}`,
      );
      const original = await fs.readFile(post.filePath, 'utf8');
      await fs.writeFile(backupPath, original, 'utf8');

      const written = await fs.readFile(backupPath, 'utf8');
      if (written !== original) {
        throw new Error('备份校验失败（备份内容与原文不一致）');
      }

      // 算新 frontmatter
      const newData = { ...post.data };
      if (isCategory) {
        newData.category = toName;
      } else {
        const replaced = (post.data.tags || []).map((t) =>
          String(t).trim() === fromName ? toName : String(t).trim(),
        );
        // 合并场景下会出现重复（原来自带 to 的那篇），去重
        newData.tags = [...new Set(replaced)];
      }

      const content = buildFile(newData, post.body);

      // 先写临时文件再改名 —— 避免写到一半留下半个文件
      const tmpPath = post.filePath + '.writing';
      await fs.writeFile(tmpPath, content, 'utf8');
      await fs.rename(tmpPath, post.filePath);

      changed.push({ slug: post.slug, title: String(post.data.title || '') });
    } catch (err) {
      failed.push({ slug: post.slug, error: String(err.message || err) });
    }
  }

  // ---- ② 写重定向 ----
  // 旧地址的页面在这次改名后就消失了（没有文章再用旧名字），
  // 所以要给旧地址留一条跳转，不然别人收藏的分类页会 404。
  //
  // 只有当改名真的生效时才写 —— 全失败还写重定向，等于指向一个空分类。
  let redirectAdded = false;
  let redirectError = '';

  if (changed.length > 0) {
    try {
      // from 不带尾斜杠（实验确认这样能被 Astro 正确匹配），to 带尾斜杠
      await addRedirects([
        { from: `${prefix}${fromName}`, to: `${prefix}${toName}/` },
      ]);
      redirectAdded = true;
    } catch (err) {
      redirectError = String(err.message || err);
    }
  }

  return {
    ...summary,
    changed,
    failed,
    redirectAdded,
    redirectError,
  };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
