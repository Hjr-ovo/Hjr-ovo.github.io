// 工具的后端服务
//
// 一个纯 Node 内置 http 模块写的服务，监听 127.0.0.1:5678。
// 无框架、无依赖（见 技术架构.md 第四节）。
//
// 它做两件事：
//   ① 把界面文件发出去（GET / 等）
//   ② 提供一组操作文章的接口（/api/*）

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TOOL_HOST, TOOL_PORT, TOOL_BASE_URL, TOOL_ROOT, CATEGORIES, POSTS_DIR, BACKUP_DIR } from './config.mjs';
import * as posts from './posts.mjs';
import * as taxonomy from './taxonomy.mjs';
import { slugify, validateSlug } from './slug.mjs';
import { today } from './frontmatter.mjs';
import { startBlog, stopBlog, getBlogStatus, openBrowser, isPortInUse } from './blog-server.mjs';

const PUBLIC_DIR = path.join(TOOL_ROOT, 'public');

// ---------------- 路由 ----------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // ---- 接口 ----
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url);
      return;
    }

    // ---- 静态文件 ----
    await serveStatic(res, pathname);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
});

// ---------------- 接口分发 ----------------

async function handleApi(req, res, pathname, url) {
  const method = req.method;

  // ---- 身份识别：确认"这个端口上跑的确实是我们这个工具" ----
  // 用途：启动脚本靠它判断"工具已经在跑了"，而不是笼统地报"端口被占"。
  if (pathname === '/api/hello' && method === 'GET') {
    return sendJson(res, 200, { ok: true, app: 'blog-tool', v: 1 });
  }

  // ---- 让已在运行的工具打开/聚焦浏览器窗口 ----
  if (pathname === '/api/focus' && method === 'POST') {
    const ok = openBrowser(TOOL_BASE_URL);
    return sendJson(res, 200, { ok, error: ok ? '' : '打开浏览器失败' });
  }

  // ---- 关闭工具自己 ----
  if (pathname === '/api/quit' && method === 'POST') {
    sendJson(res, 200, { ok: true });
    // 稍等一下再退，保证上面这个响应能发出去
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // ---- 文章：列表 ----
  if (pathname === '/api/posts' && method === 'GET') {
    const list = await posts.listPosts();
    return sendJson(res, 200, { ok: true, posts: list, postsDir: POSTS_DIR });
  }

  // ---- 文章：新建 ----
  if (pathname === '/api/posts' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await posts.createPost({
      slug: body.slug,
      data: body.data,
      body: body.body || '',
    });
    return sendJson(res, 200, { ok: true, ...result });
  }

  // ---- 文章：读单篇 / 改 / 删 / 改名 ----
  const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);

  if (postMatch) {
    const slug = decodeURIComponent(postMatch[1]);

    if (method === 'GET') {
      const post = await posts.readPost(slug);
      return sendJson(res, 200, { ok: true, post });
    }

    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const result = await posts.updatePost({
        slug,
        data: body.data,
        body: body.body || '',
        bumpUpdatedDate: body.bumpUpdatedDate !== false,
      });
      // 不把 previousContent 发回去（可能很大，且没用）
      return sendJson(res, 200, {
        ok: true,
        slug: result.slug,
        warnings: result.warnings,
      });
    }

    if (method === 'DELETE') {
      const result = await posts.deletePost(slug);
      return sendJson(res, 200, { ok: true, ...result });
    }
  }

  // ---- 文章：改名（独立动作）----
  if (pathname === '/api/rename' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await posts.renamePost({
      oldSlug: body.oldSlug,
      newSlug: body.newSlug,
    });
    return sendJson(res, 200, { ok: true, ...result });
  }

  // ---- 工具：生成文件名候选 ----
  if (pathname === '/api/slug' && method === 'POST') {
    const body = await readJsonBody(req);
    const candidate = slugify(body.title || '');
    const check = validateSlug(candidate);
    return sendJson(res, 200, {
      ok: true,
      candidate,
      valid: check.ok,
      reason: check.reason || '',
    });
  }

  // ---- 博客：状态 / 启动 ----
  if (pathname === '/api/blog/status' && method === 'GET') {
    const status = await getBlogStatus();
    return sendJson(res, 200, { ok: true, ...status });
  }

  if (pathname === '/api/blog/start' && method === 'POST') {
    const result = await startBlog();
    // 起来了就顺手打开浏览器
    if (result.ok) openBrowser(url.searchParams.get('open') === '0' ? '' : 'http://localhost:4321/');
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/blog/stop' && method === 'POST') {
    const result = await stopBlog();
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/blog/open' && method === 'POST') {
    const ok = openBrowser('http://localhost:4321/');
    return sendJson(res, 200, { ok, error: ok ? '' : '打开浏览器失败' });
  }

  // ---- 分类 / 标签：统计 ----
  // 站点上已经能看到分类页和标签页了，这个接口让工具里也能看到同样一份数据：
  // 有哪些分类/标签、各多少篇、其中几篇是草稿（草稿在站点上不显示）。
  if (pathname === '/api/taxonomy' && method === 'GET') {
    const data = await taxonomy.listTaxonomy();
    return sendJson(res, 200, { ok: true, ...data });
  }

  // ---- 分类 / 标签：改名 / 合并 ----
  // ⚠️ 分类名和标签名会进 URL，改名等于改地址，所以后端会顺手写一条重定向。
  // dryRun:true 时只算不写，供界面先显示"会影响多少篇"。
  if (pathname === '/api/taxonomy/rename' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await taxonomy.renameTaxonomy({
      kind: body.kind,
      from: body.from,
      to: body.to,
      dryRun: body.dryRun === true,
    });
    return sendJson(res, 200, { ok: true, ...result });
  }

  // ---- 元信息：分类清单、今天日期、路径 ----
  if (pathname === '/api/meta' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      categories: CATEGORIES,
      today: today(),
      postsDir: POSTS_DIR,
      backupDir: BACKUP_DIR,
    });
  }

  sendJson(res, 404, { ok: false, error: '没有这个接口：' + pathname });
}

// ---------------- 静态文件 ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;

  // 防路径穿越：解析后必须仍在 public 目录内
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('403');
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 找不到：' + pathname);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(content);
}

// ---------------- 辅助 ----------------

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // 简单防护：正文不可能超过 10MB
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error('提交的内容太大了（超过 10MB）'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (data === '') return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('请求内容不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------- 启动 ----------------

// --quiet：给「启动.bat」用。窗口会自己关掉，没人看那一大坨横幅，
// 所以只留几行关键信息（会写进 启动日志.txt）。
const QUIET = process.argv.includes('--quiet');

async function main() {
  // 端口检查：先确认 5678 没被占
  if (await isPortInUse(TOOL_PORT)) {
    // 占了端口的是不是「我们自己」？是的话就当重复启动处理，别吓着用户
    if (await isOurToolRunning()) {
      console.log('博客管理工具已经开着了，正在打开界面……');
      console.log(TOOL_BASE_URL);
      openBrowser(TOOL_BASE_URL);
      process.exit(0);
    }

    // 真的是别的程序占了
    console.error('');
    console.error(`✗ 端口 ${TOOL_PORT} 被别的程序占用了（那个程序不是本工具）。`);
    console.error('  改一下 src/config.mjs 里的 TOOL_PORT 换个端口试试。');
    console.error('');
    process.exit(1);
  }

  server.listen(TOOL_PORT, TOOL_HOST, () => {
    if (QUIET) {
      console.log(`博客管理工具已启动： ${TOOL_BASE_URL}`);
      console.log(`文章目录： ${POSTS_DIR}`);
      console.log(`删除备份： ${BACKUP_DIR}`);
    } else {
      console.log('');
      console.log('  博客管理工具已启动');
      console.log('  ────────────────────────────────────────');
      console.log(`  管理界面：  ${TOOL_BASE_URL}`);
      console.log(`  文章目录：  ${POSTS_DIR}`);
      console.log(`  删除备份：  ${BACKUP_DIR}`);
      console.log('  ────────────────────────────────────────');
      console.log('  想关闭工具：用界面右上角的「关闭工具」按钮');
      console.log('');
    }

    openBrowser(TOOL_BASE_URL);
  });
}

// 问一下端口上的服务："你是博客管理工具吗？"
async function isOurToolRunning() {
  try {
    const res = await fetch(`http://${TOOL_HOST}:${TOOL_PORT}/api/hello`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.app === 'blog-tool';
  } catch {
    return false;
  }
}

main();
