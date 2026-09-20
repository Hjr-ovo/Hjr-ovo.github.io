// Astro 开发服务器的进程管理
//
// 负责三件事：
//   ① 检测 4321 端口上是不是已经跑着 Astro
//   ② 没跑就启动它（调 npm run dev）
//   ③ 启动后自动打开浏览器
//
// 设计要点（见 技术架构.md 第六节）：
//   - 工具**不接管** Astro 的进程管理。它只是"替你敲了一次 npm run dev"，
//     服务器仍然是一个独立进程，你在别处照样能控制它。
//   - 已经在跑就**不重复启动** —— 重复启动只会撞端口报错。

import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ASTRO_PORT, NODE_EXE, NPM_CLI, SITE_ROOT, BLOG_URL } from './config.mjs';

// 记录由本工具启动的 Astro 进程（只用于"是否是我们起的"的判断，不做强制管理）
let spawnedProcess = null;

/**
 * 检测某端口上是否已经有服务在监听
 *
 * ⚠️ 必须同时试 IPv4 和 IPv6 两个地址 —— 这是实测踩到的坑（2026-09-20）：
 *   Astro 的 dev server 默认只绑 **IPv6 的 ::1**，不绑 IPv4 的 127.0.0.1。
 *   只查 127.0.0.1 会得到"没在跑"的错误结论，于是工具会以为博客没起来、
 *   白等 60 秒，然后误报失败（而其实博客早就好了）。
 *
 * 浏览器访问 localhost 时两种都会试，所以用户那边从来感觉不到这个差异 ——
 * 只有程序自己按固定 IP 去连的时候才会暴露。
 */
export async function isPortInUse(port) {
  const results = await Promise.all([
    tryConnect(port, '127.0.0.1'),
    tryConnect(port, '::1'),
  ]);
  return results.some(Boolean);
}

function tryConnect(port, host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    // 超时兜底（连不上时不能一直等）
    socket.setTimeout(800);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    const fail = () => {
      socket.destroy();
      resolve(false);
    };

    socket.once('error', fail);
    socket.once('timeout', fail);

    try {
      socket.connect(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * 确认端口上的服务是不是 Astro 博客
 *
 * 光看"端口被占用"不够 —— 可能是别的程序。
 * 所以要再发个 HTTP 请求，看看返回的是不是我们的页面。
 *
 * 同样两个地址都试（理由见 isPortInUse 的注释）。
 */
export async function isBlogRunning() {
  const candidates = [
    `http://localhost:${ASTRO_PORT}/`,
    `http://127.0.0.1:${ASTRO_PORT}/`,
    `http://[::1]:${ASTRO_PORT}/`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // 这个地址不通就试下一个
    }
  }

  return false;
}

/**
 * 启动 Astro 开发服务器
 *
 * @returns {Promise<{ok: boolean, alreadyRunning: boolean, message: string, output?: string}>}
 */
export async function startBlog() {
  // ---- ① 已经在跑就直接返回 ----
  if (await isBlogRunning()) {
    return {
      ok: true,
      alreadyRunning: true,
      message: '博客已经在运行了，直接打开页面。',
    };
  }

  // ---- ② 端口被别的程序占了 ----
  if (await isPortInUse(ASTRO_PORT)) {
    return {
      ok: false,
      alreadyRunning: false,
      message:
        `端口 ${ASTRO_PORT} 被别的程序占用了，但不是我们的博客。\n` +
        '请先关掉占用它的程序，或改用别的端口。',
    };
  }

  // ---- ③ 启动 ----
  return new Promise((resolve) => {
    let output = '';

    // 启动前先确认工具要用到的东西都在，不然报错会很难懂
    const missing = [];
    if (!fs.existsSync(NODE_EXE)) missing.push('node: ' + NODE_EXE);
    if (!fs.existsSync(NPM_CLI)) missing.push('npm: ' + NPM_CLI);
    if (!fs.existsSync(SITE_ROOT)) missing.push('站点目录: ' + SITE_ROOT);

    if (missing.length > 0) {
      resolve({
        ok: false,
        alreadyRunning: false,
        message:
          '找不到这些必需的东西：\n' +
          missing.map((m) => '  · ' + m).join('\n') +
          '\n\n可能是 Node.js 装在了别的位置 —— 打开 src/config.mjs 改一下路径。',
      });
      return;
    }

    let child;
    try {
      // ⚠️ 关键：不用 shell，直接 node 跑 npm 的入口脚本。
      //    用 shell 的话，路径里的空格会把 cmd.exe 搞糊涂
      //    （实测报 `'C:\Program' 不是内部或外部命令`）。
      child = spawn(NODE_EXE, [NPM_CLI, 'run', 'dev'], {
        cwd: SITE_ROOT,
        shell: false,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      });
    } catch (err) {
      resolve({
        ok: false,
        alreadyRunning: false,
        message: '启动失败：' + err.message,
      });
      return;
    }

    spawnedProcess = child;

    const collect = (buf) => {
      // 去掉 ANSI 颜色码 —— 否则把日志显示到界面上会是一堆 ^[[36m 之类的乱码
      const text = buf.toString().replace(/\x1b\[[0-9;]*m/g, '');
      output += text;
      // 只留最后一段，免得日志无限长
      if (output.length > 8000) output = output.slice(-8000);
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', (err) => {
      resolve({
        ok: false,
        alreadyRunning: false,
        message: '启动 Astro 失败：' + err.message,
      });
    });

    // ---- ④ 轮询等待它就绪 ----
    // 不傻等固定秒数 —— 而是真的去访问，通了才算好。
    const deadline = Date.now() + 60000; // 最多等 60 秒
    let settled = false;

    const poll = async () => {
      if (settled) return;

      if (await isBlogRunning()) {
        settled = true;
        resolve({
          ok: true,
          alreadyRunning: false,
          message: '博客已启动。',
          output: tail(output),
        });
        return;
      }

      if (Date.now() > deadline) {
        settled = true;
        resolve({
          ok: false,
          alreadyRunning: false,
          message:
            '等了 60 秒博客还没起来。可能是依赖没装（在 site 目录跑一次 npm install --ignore-scripts），' +
            '或者首次启动比较慢，稍后手动刷新试试。',
          output: tail(output),
        });
        return;
      }

      setTimeout(poll, 700);
    };

    // 稍等一下再开始轮询（Astro 需要点时间才建好监听）
    setTimeout(poll, 1200);

    // 进程提前退出 = 出错了，不用再等
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        alreadyRunning: false,
        message: `Astro 进程退出了（退出码 ${code}）。`,
        output: tail(output),
      });
    });
  });
}

/**
 * 状态查询：博客现在跑着没
 */
export async function getBlogStatus() {
  const running = await isBlogRunning();
  return {
    running,
    url: BLOG_URL,
    port: ASTRO_PORT,
    startedByTool: spawnedProcess !== null && !spawnedProcess.killed,
  };
}

function tail(text, lines = 25) {
  const arr = text.split('\n');
  return arr.slice(-lines).join('\n');
}

/**
 * 打开浏览器
 *
 * Windows 用 start 命令。注意 start 的第一个参数是"窗口标题"，
 * 所以写 start "" <url>，那个空引号不能省。
 */
export function openBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return true;
  } catch {
    return false;
  }
}
