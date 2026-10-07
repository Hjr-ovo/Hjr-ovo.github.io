// 文章仓库：所有对 .md 文件的读写都在这里
//
// 设计原则（见 技术架构.md 第七节）：
//   **不缓存文章内容** —— 每次操作前重新读磁盘。
//   理由：用户可能同时在 Obsidian 里改这些文件。
//   缓存会让工具显示"它以为的样子"，而不是"文件的真实样子"。

import fs from 'node:fs/promises';
import path from 'node:path';

import { POSTS_DIR, BACKUP_DIR, REDIRECTS_FILE, POST_URL_PREFIX } from './config.mjs';
import { parseFrontmatter, buildFile, today, checkBody } from './frontmatter.mjs';
import { validateSlug } from './slug.mjs';

// ---------- 列表 ----------

/**
 * 列出所有文章
 *
 * @returns {Promise<Array>} 按发布日期倒序
 */
export async function listPosts() {
  await ensureDirs();

  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });

  const posts = [];

  for (const entry of entries) {
    // 只认 .md / .mdx 文件，跳过文件夹和别的杂物
    if (!entry.isFile()) continue;
    if (!/\.(md|mdx)$/i.test(entry.name)) continue;

    // 跳过下划线开头的临时文件（如 _schema-test.md）
    if (entry.name.startsWith('_')) continue;

    const slug = entry.name.replace(/\.(md|mdx)$/i, '');
    const filePath = path.join(POSTS_DIR, entry.name);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const { data, body } = parseFrontmatter(raw);

      posts.push({
        slug,
        fileName: entry.name,
        title: String(data.title || '(缺标题)'),
        description: String(data.description || ''),
        pubDate: String(data.pubDate || ''),
        updatedDate: data.updatedDate ? String(data.updatedDate) : '',
        category: String(data.category || ''),
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: data.draft === true,
        // 正文字数，给界面显示用
        charCount: body.trim().length,
        // 这篇文件格式是否正常解析了
        parseOk: true,
      });
    } catch (err) {
      // 单篇解析失败不能让整个列表崩掉 —— 标出来，让用户能看到是哪篇有问题
      posts.push({
        slug,
        fileName: entry.name,
        title: `⚠️ ${entry.name}（格式有问题）`,
        description: String(err.message || err),
        pubDate: '',
        updatedDate: '',
        category: '',
        tags: [],
        draft: false,
        charCount: 0,
        parseOk: false,
      });
    }
  }

  // 倒序：新的在前。日期缺失的排最后。
  posts.sort((a, b) => {
    if (!a.pubDate && !b.pubDate) return a.slug.localeCompare(b.slug);
    if (!a.pubDate) return 1;
    if (!b.pubDate) return -1;
    return b.pubDate.localeCompare(a.pubDate);
  });

  return posts;
}

// ---------- 读单篇 ----------

/**
 * 读一篇文章的完整内容
 *
 * @param {string} slug 文件名（不含扩展名）
 * @returns {Promise<{data: object, body: string, slug: string, fileName: string}>}
 */
export async function readPost(slug) {
  assertSafeSlug(slug);

  const filePath = resolvePostPath(slug);

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`找不到文章 \`${slug}\`（文件可能已被删除或改名）`);
    }
    throw err;
  }

  const { data, body } = parseFrontmatter(raw);

  return { slug, fileName: path.basename(filePath), data, body };
}

// ---------- 新建 ----------

/**
 * 新建一篇文章
 *
 * @param {object} params
 * @param {string} params.slug 文件名（不含 .md）
 * @param {object} params.data frontmatter
 * @param {string} params.body 正文
 */
export async function createPost({ slug, data, body }) {
  assertSafeSlug(slug);

  const check = validateSlug(slug);
  if (!check.ok) throw new Error('文件名不合规范：' + check.reason);

  const filePath = resolvePostPath(slug);

  // ★ 关键：已存在就拒绝，绝不覆盖
  if (await exists(filePath)) {
    throw new Error(
      `已经有叫 \`${slug}\` 的文章了。\n` +
        '换个文件名吧 —— 工具不会覆盖已存在的文件，这是故意的。',
    );
  }

  // 新建时若没给发布日期，用今天
  const payload = { ...data };
  if (!payload.pubDate) payload.pubDate = today();

  const content = buildFile(payload, body);

  await fs.writeFile(filePath, content, 'utf8');

  return { slug, filePath };
}

// ---------- 更新 ----------

/**
 * 更新一篇文章
 *
 * 注意：**不改文件名**（见 ADR-011）。
 * 改文件名是另一个独立动作 renamePost()，必须由用户明确触发。
 *
 * @param {object} params
 * @param {string} params.slug 当前文件名
 * @param {object} params.data 新的 frontmatter
 * @param {string} params.body 新的正文
 * @param {boolean} params.bumpUpdatedDate 是否把 updatedDate 设为今天（默认 true）
 */
export async function updatePost({ slug, data, body, bumpUpdatedDate = true }) {
  assertSafeSlug(slug);

  const filePath = resolvePostPath(slug);

  if (!(await exists(filePath))) {
    throw new Error(`找不到文章 \`${slug}\`，可能已被删除或改名`);
  }

  // 留一份改动前的快照，万一写坏了能手工回滚
  const before = await fs.readFile(filePath, 'utf8');

  const payload = { ...data };
  if (bumpUpdatedDate) {
    payload.updatedDate = today();
  }

  const content = buildFile(payload, body);

  const warnings = checkBody(body);

  // 先写临时文件再改名 —— 避免写到一半断电留下半个文件
  const tmpPath = filePath + '.writing';
  await fs.writeFile(tmpPath, content, 'utf8');

  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // rename 失败（常见于 Windows 上文件被占用）→ 清理临时文件再报错
    await fs.rm(tmpPath, { force: true });
    throw new Error(
      '写文件失败，可能有程序正占用着它（比如编辑器没关）。\n' +
        '原文件没有被改动。\n' +
        '原始错误：' +
        err.message,
    );
  }

  return { slug, warnings, previousContent: before };
}

// ---------- 改名（独立动作，见 ADR-011）----------

/**
 * 给文章改文件名（= 换 URL）
 *
 * ⚠️ 这个动作会改变文章 URL。
 * 工具会顺手做两件事把旧链接接住（见 技术架构.md 5.5.2）：
 *   ① 往重定向表里追加一条「旧地址 → 新地址」，
 *      构建时 Astro 会在旧地址生成一个跳转页，访问者不会 404；
 *   ② 把旧文件另存一份到备份目录，万一改错还能捞回来。
 *
 * @param {object} params
 * @param {string} params.oldSlug 旧文件名
 * @param {string} params.newSlug 新文件名
 */
export async function renamePost({ oldSlug, newSlug }) {
  assertSafeSlug(oldSlug);
  assertSafeSlug(newSlug);

  const check = validateSlug(newSlug);
  if (!check.ok) throw new Error('新文件名不合规范：' + check.reason);

  const oldPath = resolvePostPath(oldSlug);
  const newPath = resolvePostPath(newSlug);

  if (!(await exists(oldPath))) {
    throw new Error(`找不到文章 \`${oldSlug}\``);
  }

  if (await exists(newPath)) {
    throw new Error(`已经有叫 \`${newSlug}\` 的文件了，不能覆盖`);
  }

  // ---- ① 备份旧文件（跟删除走同一套逻辑：备份目录 + 时间戳）----
  await ensureDirs();

  const raw = await fs.readFile(oldPath, 'utf8');
  const backupPath = path.join(BACKUP_DIR, `${timestamp()}__renamed__${oldSlug}.md`);
  await fs.writeFile(backupPath, raw, 'utf8');

  // 回读验证备份真的落盘了（BUG-002 的教训：不信任"写操作没报错"）
  const written = await fs.readFile(backupPath, 'utf8');
  if (written !== raw) {
    throw new Error(
      '备份校验失败 —— 备份文件内容和原文不一致。\n' +
        '为安全起见，改名没有执行。请重试。',
    );
  }

  // ---- ② 改文件名 ----
  await fs.rename(oldPath, newPath);

  // ---- ③ 把旧地址记进重定向表 ----
  // 失败不阻断改名（文件已经改好了），但要把情况报上去让界面提示用户
  let redirectAdded = false;
  let redirectError = '';
  try {
    await addRedirect(oldSlug, newSlug);
    redirectAdded = true;
  } catch (err) {
    redirectError = err.message || String(err);
  }

  return {
    oldSlug,
    newSlug,
    oldUrl: `${POST_URL_PREFIX}${oldSlug}/`,
    newUrl: `${POST_URL_PREFIX}${newSlug}/`,
    backupPath,
    redirectAdded,
    redirectError,
  };
}

// ---------- 重定向表 ----------

/**
 * 往重定向表里追加一条「旧文件名 → 新文件名」
 *
 * 表结构（site/src/data/redirects.json）：
 *   { "redirects": { "old-name": "new-name" } }
 *
 * 三种边界情况都处理：
 *   · 表不存在      → 建一个新的
 *   · 表内容坏了    → 报错，不覆盖（宁可让用户看到，也不静默丢掉已有记录）
 *   · 旧名已经有记录 → 顺着链往下追，改成最终的那个新名（避免 A→B→C 的跳转链）
 */
async function addRedirect(oldSlug, newSlug) {
  const table = await readRedirectTable();

  // 如果这个旧名之前已经指向别处（A→B），现在又 B→C，
  // 直接把 A 改指到 C —— 跳转链每多一跳都损耗权重，Google 跟到第 5 跳就放弃
  table.redirects[oldSlug] = newSlug;

  // 顺带反向修正：如果表里已经有人指向 oldSlug，把它也一并指到 newSlug
  for (const [key, value] of Object.entries(table.redirects)) {
    if (value === oldSlug && key !== oldSlug) {
      table.redirects[key] = newSlug;
    }
  }

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
      return {
        _说明: '文章改名后，旧地址 → 新地址的对照表。由博客管理工具在改名时自动追加，一般不用手改。',
        _格式: '键是旧文件名，值是新文件名。例如 "old-name": "new-name"',
        _为什么需要:
          '静态站没有服务端，删除旧文件后旧链接会直接 404。这张表让构建时自动生成一个跳转页顶替旧位置。',
        redirects: {},
      };
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

// ---------- 删除（最危险，先备份）----------

/**
 * 删除一篇文章
 *
 * 流程（见 技术架构.md 5.6）：
 *   ① 先复制到备份目录（带时间戳）
 *   ② 确认备份真的成功了，才删原文件
 *   ③ 返回备份位置，让界面告诉用户"删错了能去哪找回来"
 */
export async function deletePost(slug) {
  assertSafeSlug(slug);

  const filePath = resolvePostPath(slug);

  if (!(await exists(filePath))) {
    throw new Error(`找不到文章 \`${slug}\`，可能已经被删了`);
  }

  await ensureDirs();

  // ---- ① 备份 ----
  const stamp = timestamp();
  const backupName = `${stamp}__${path.basename(filePath)}`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  const raw = await fs.readFile(filePath, 'utf8');
  await fs.writeFile(backupPath, raw, 'utf8');

  // ---- ② 验证备份 ----
  // 不信任"写操作没报错"，而是回读确认内容真的落盘了（BUG-002 的教训）
  const written = await fs.readFile(backupPath, 'utf8');
  if (written !== raw) {
    throw new Error(
      '备份校验失败 —— 备份文件的内容和原文不一致。\n' +
        '为安全起见，原文件没有被删除。请重试。',
    );
  }

  // ---- ③ 删原文件 ----
  const stat = await fs.stat(filePath);
  await fs.rm(filePath);

  return {
    slug,
    backupPath,
    sizeBytes: stat.size,
    // 备份只在 .workbuddy/tmp/ 里，界面上要给用户完整路径
    restoredHint: `把 ${backupPath} 复制回 ${POSTS_DIR} 即可恢复`,
  };
}

// ---------- 内部工具 ----------

async function ensureDirs() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * 把 slug 变成完整文件路径
 *
 * 找到就用原扩展名（.md 或 .mdx），找不到默认 .md
 */
function resolvePostPath(slug) {
  // 简单处理：默认 .md。（.mdx 极少用，真遇到了走 readPost 的报错路径提示）
  return path.join(POSTS_DIR, slug + '.md');
}

/**
 * ★ 安全检查：防止 slug 里塞进 ../ 之类的东西跑到别的目录去
 *
 * 虽然只有自己用，但这是"写文件"的工具，
 * 一个路径穿越就能误删仓库里别的文件。不省这一步。
 */
function assertSafeSlug(slug) {
  const s = String(slug || '');

  if (s === '') throw new Error('文件名不能为空');

  if (s.includes('/') || s.includes('\\')) {
    throw new Error('文件名里不能有斜杠');
  }

  if (s.includes('..')) {
    throw new Error('文件名里不能有 ..');
  }

  if (path.isAbsolute(s)) {
    throw new Error('文件名不能是绝对路径');
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

// ---------- 供外部使用 ----------

export { POSTS_DIR, BACKUP_DIR, REDIRECTS_FILE };
