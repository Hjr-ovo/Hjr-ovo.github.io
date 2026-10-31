// 文章管家的本地服务（零依赖，只用 Node 内置模块）
//
// 只监听 127.0.0.1，只给自己用。不做登录 —— 它就是一个「能点按钮的文件编辑器」。
// 用 IP 而不是 localhost：Windows 上 localhost 可能先解析成 ::1，
// 而这里监听的是 IPv4，会连不上（BUG-007 踩过）。

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

import { listPosts, readPost, savePost, taxonomy } from './posts.mjs';
import { analyze, writePost, existingCategories } from './ingest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5678);
const BLOG_URL = 'http://localhost:4321';
const PREVIEW_BAT = path.resolve(__dirname, '../../预览.bat');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- 小工具 ----------

function json(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('内容太大了'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求内容不是合法 JSON'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

/** 探测站点 dev 是否在跑 */
function probeDev() {
  return new Promise((resolve) => {
    const req = http.get(BLOG_URL + '/', { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---------- 路由 ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'posts', slug?]

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const [dev, tx] = await Promise.all([probeDev(), taxonomy()]);
    return json(res, 200, { dev, blogUrl: BLOG_URL, today: tx.today, postsDir: (await import('./posts.mjs')).POSTS_DIR });
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const data = await listPosts();
    return json(res, 200, data);
  }

  if (req.method === 'GET' && url.pathname === '/api/taxonomy') {
    return json(res, 200, await taxonomy());
  }

  if (parts[0] === 'api' && parts[1] === 'posts' && parts.length === 3) {
    const slug = decodeURIComponent(parts[2]);

    if (req.method === 'GET') {
      try {
        const post = await readPost(slug);
        return json(res, 200, post);
      } catch (err) {
        return json(res, err.code === 'NOT_FOUND' ? 404 : 500, { error: err.message, code: err.code });
      }
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      try {
        const result = await savePost(slug, body);
        return json(res, 200, result);
      } catch (err) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : err.code === 'INVALID' ? 422 : 500;
        return json(res, status, { error: err.message, code: err.code, problems: err.problems });
      }
    }
  }

  // 入库：先诊断
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    const body = await readBody(req);
    if (typeof body.raw !== 'string') return json(res, 400, { error: '缺少文件内容' });
    const result = analyze(body.raw, {
      filename: body.filename,
      existingCategories: await existingCategories(),
    });
    return json(res, 200, result);
  }

  // 入库：真的写
  if (req.method === 'POST' && url.pathname === '/api/ingest') {
    const body = await readBody(req);
    try {
      const result = await writePost(body);
      return json(res, 200, result);
    } catch (err) {
      const status = err.code === 'EXISTS' || err.code === 'BAD_SLUG' || err.code === 'INVALID' ? 422 : 500;
      return json(res, status, { error: err.message, code: err.code });
    }
  }

  // 打开预览：交给根目录 预览.bat，不自己起进程（避免和 bat 抢端口）
  if (req.method === 'POST' && url.pathname === '/api/open-dev') {
    exec(`start "" "${PREVIEW_BAT}"`, { windowsHide: true }, () => {});
    return json(res, 200, { launched: true });
  }

  return json(res, 404, { error: '没有这个接口' });
}

async function serveStatic(res, pathname) {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC_DIR, clean === '/' ? 'index.html' : clean);

  // 防目录穿越
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
    const buf = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return json(res, 405, { error: '不支持的方法' });
    return await serveStatic(res, url.pathname);
  } catch (err) {
    json(res, 500, { error: err.message || String(err), code: err.code });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  文章管家已启动');
  console.log(`  地址：http://${HOST}:${PORT}/`);
  console.log('  关掉这个窗口就停止。');
  console.log('');

  // 端口真的就绪之后才开浏览器（bat 里设 OPEN_BROWSER=1）。
  // 反过来先开浏览器的话，会看到「无法连接」，还得手动刷新。
  if (process.env.OPEN_BROWSER === '1') {
    exec(`start "" "http://${HOST}:${PORT}/"`, { windowsHide: true }, () => {});
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 被占用了 —— 可能管家已经在另一个窗口里开着。`);
    console.error(`  直接打开 http://${HOST}:${PORT}/ 试试。\n`);
  } else {
    console.error('\n  启动失败：', err.message, '\n');
  }
  process.exit(1);
});
