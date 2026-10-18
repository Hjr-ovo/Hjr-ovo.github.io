// Astro 开发服务器的进程管理
//
// 负责这几件事：
//   ① 检测 4321 端口上是不是已经跑着 Astro
//   ② 没跑就启动它（调 npm run dev）
//   ③ 启动后自动打开浏览器
//   ④ 关掉它（先温柔、超时再强杀）
//
// 设计要点（见 技术架构.md 第六节）：
//   - 服务器是一个**独立进程** —— 工具只是"替你敲了一次 npm run dev"。
//     关博客**不会**动管理工具，关管理工具也**不会**动博客（两者独立）。
//   - 已经在跑就**不重复启动** —— 重复启动只会撞端口报错。
//   - 关的时候要认准"这是我们的博客"，别把别人的程序杀了（见 stopBlog 注释）。

import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  ASTRO_PORT,
  NODE_EXE,
  NPM_CLI,
  SITE_ROOT,
  BLOG_URL,
  BLOG_PID_FILE,
} from './config.mjs';

// 记录由本工具启动的 Astro 进程（内存里的那份，用来快速判断）
let spawnedProcess = null;

// 温柔关闭的等待上限。超过就强杀。
const GRACEFUL_WAIT_MS = 5000;

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

    // 把进程号落盘：这样管理工具自己重启过，也还能找到这个博客进程。
    // （内存里的 spawnedProcess 会随工具关闭而丢失，磁盘上这份不会。）
    savePid(child.pid);

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
 * 找出手上这个 Astro 博客的进程号
 *
 * ⚠️ 这里为什么不用 netstat 查 4321 端口？（2026-10-07 实测推翻了原方案）
 *    两个原因叠加，导致"查端口"这条路根本走不通：
 *      ① Astro 的 dev server 默认**只绑 IPv6 的 ::1**，不绑 IPv4
 *         （见 isPortInUse 注释，也踩过 BUG-007）；
 *      ② 即便绑了，`netstat -ano` 在这台机器上**压根不显示 4321 那一行**
 *         —— 试了 127.0.0.1 / ::1 / 0.0.0.0 全都没有。
 *
 *    所以改成**按命令行认人**：Astro 进程的命令行长这样
 *      "node" "D:\file\myblogweb\site\node_modules\.bin\..\astro\bin\astro.mjs" dev
 *    拿它做匹配，既准确又不会误伤别的 node 程序。
 *
 * @returns {Promise<number|null>} 进程号；找不到就 null
 */
async function findAstroPid() {
  try {
    const json = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]);

    if (!json || !json.trim()) return null;

    let list;
    try {
      const parsed = JSON.parse(json);
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }

    // 规范化站点路径，好做包含判断（大小写不敏感）
    const siteKey = SITE_ROOT.toLowerCase();

    const matches = [];
    for (const p of list) {
      const cl = String(p.CommandLine || '').toLowerCase();
      if (!cl) continue;
      // 必须同时提到 astro 和我们的 site 目录 —— 两个条件都满足才算我们的
      const isAstro = cl.includes('astro');
      const isOurSite = cl.includes(siteKey) || cl.includes(siteKey.replace(/\\/g, '\\\\'));
      if (isAstro && isOurSite) {
        const pid = Number.parseInt(p.ProcessId, 10);
        if (Number.isInteger(pid) && pid > 0) matches.push(pid);
      }
    }

    if (matches.length === 0) return null;

    // 理论上只会有一个；万一有多个（残留进程），挑最小的那个（通常是较早起的）
    matches.sort((a, b) => a - b);
    return matches[0];
  } catch {
    return null;
  }
}

/**
 * 跑一个命令，把 stdout 收成字符串
 *
 * ⚠️ 必须用异步的 spawn，**不能用 spawnSync**（2026-10-07 实测）：
 *    这台机器上 spawnSync 调任何外部命令都直接返回 EBUSY
 *    （`spawnSync netstat EBUSY` / `spawnSync taskkill EBUSY`），
 *    异步 spawn 则完全正常。同步版会让"关闭博客"永远失败。
 */
function runCommand(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;

    const finish = (s) => {
      if (done) return;
      done = true;
      resolve(s);
    };

    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      return finish('');
    }

    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', () => { /* 错误信息用不上，忽略 */ });
    child.on('error', () => finish(''));
    child.on('close', () => finish(out));

    // 兜底超时，免得命令卡住把请求挂死
    setTimeout(() => {
      try { child.kill(); } catch { /* 已经退了就算了 */ }
      finish(out);
    }, 10000);
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

// ---------------- 关闭 ----------------

/**
 * 关闭博客
 *
 * 策略（用户 2026-09-22 定）：先温柔、超时再强杀。
 *
 * 但"温柔"是有前提的 —— 得先**认准这个进程是我们的博客**，否则宁可不动。
 * 认法分两级（B2 + B3）：
 *   B2. 优先用启动时记下的进程号（内存 → 磁盘都找一遍）
 *   B3. 进程号丢了，就回退到"谁占着 4321 端口"，且必须是 node 进程
 *
 * ⚠️ 绝对不能"看到端口占用就杀" —— 万一 4321 被别的程序占了，
 *    那就是在杀别人的东西。查不到 / 不是 node → 直接报错收手。
 *
 * @returns {Promise<{ok: boolean, message: string, method?: string}>}
 */
export async function stopBlog() {
  // ---- ① 真的没在跑？那没什么可关的 ----
  if (!(await isBlogRunning())) {
    clearPid();
    return { ok: true, message: '博客本来就没在运行。' };
  }

  // ---- ② 找出目标进程号（B2：先看记录的）----
  let pid = readPid();
  let method = pid ? 'PID 记录' : '';

  // 记录的进程号还活着吗？（可能早就退出了，只是文件没清）
  if (pid && !(await isProcessAlive(pid))) {
    pid = null;
    method = '';
    clearPid();
  }

  // ---- ③ 记录的没了 → B3：按命令行认人（findAstroPid）----
  if (!pid) {
    const found = await findAstroPid();

    if (found === null) {
      return {
        ok: false,
        message:
          '博客页面确实在响应，但没能查出是哪个进程在跑。\n' +
          '可能是权限不够。可以手动关掉那个黑窗口，或去任务管理器结束 node.exe。',
      };
    }

    pid = found;
    method = '命令行反查';
  }

  // ---- ④ 先温柔：请求它自己退出 ----
  const gentleOk = await gracefulKill(pid);

  if (gentleOk) {
    clearPid();
    spawnedProcess = null;
    return {
      ok: true,
      method,
      message: `博客已关闭（进程 ${pid}，已正常退出）。`,
    };
  }

  // ---- ⑤ 温柔没成 → 强杀 ----
  const forceOk = await forceKill(pid);

  if (forceOk) {
    clearPid();
    spawnedProcess = null;
    return {
      ok: true,
      method,
      message: `博客已关闭（进程 ${pid}，温柔关闭超时后强制结束）。`,
    };
  }

  return {
    ok: false,
    message: `尝试关闭进程 ${pid} 失败了。可以去任务管理器手动结束它。`,
  };
}

/**
 * 温柔关闭：请求它自己退出，等一会儿看它走不走。
 *
 * ⚠️ 关于"温柔"在 Windows 上的实情（2026-10-07 实测）：
 *    taskkill **不带 /F** 发的是 WM_CLOSE，而我们的 node 是 windowsHide
 *    起的、没有窗口 —— 收不到这个消息，所以实测总是走到"超时强杀"。
 *    留着这一步的意义是：万一将来进程形态变了（比如换成有窗口的方式起），
 *    它就能自动受益，不用改代码。代价只是多等几秒。
 *
 * @returns {Promise<boolean>} 是否在等待窗口内正常退出
 */
async function gracefulKill(pid) {
  await runCommand('taskkill', ['/PID', String(pid)]);

  const deadline = Date.now() + GRACEFUL_WAIT_MS;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive(pid))) return true;
    await sleep(250);
  }

  return !(await isProcessAlive(pid));
}

/**
 * 强杀：taskkill /F /T
 *
 * /T 表示连子进程一起结束 —— npm run dev 会再起一个 node 子进程，
 * 只杀父进程的话子进程会变成"孤儿"继续占着端口，等于没关掉。
 */
async function forceKill(pid) {
  await runCommand('taskkill', ['/F', '/T', '/PID', String(pid)]);

  // 给它一点时间真的退掉再判定
  for (let i = 0; i < 10; i++) {
    if (!(await isProcessAlive(pid))) return true;
    await sleep(200);
  }
  return !(await isProcessAlive(pid));
}

// ---------------- 进程号记录 ----------------

function savePid(pid) {
  try {
    fs.mkdirSync(path.dirname(BLOG_PID_FILE), { recursive: true });
    fs.writeFileSync(BLOG_PID_FILE, String(pid), 'utf8');
  } catch {
    // 落盘失败不影响运行，内存里那份还在
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(BLOG_PID_FILE, 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function clearPid() {
  try {
    fs.rmSync(BLOG_PID_FILE, { force: true });
  } catch {
    // 删不掉就算了
  }
}

/** 这个进程号还活着吗？ */
async function isProcessAlive(pid) {
  try {
    // 信号 0 不真的发信号，只做权限/存在性检查
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
