// 启动包装器：由「启动.bat」用 Start-Process 拉起
//
// 为什么需要它：
//   直接把 node 的输出重定向给一个文件，会让 Start-Process 等子进程结束，
//   .bat 于是不退出、黑窗口一直挂着（实测过，见 BUG-010）。
//
//   改成：Start-Process 只负责把这个包装器拉起来（不带任何重定向参数），
//   包装器自己再 spawn 真正的 server，并把它的输出写进日志文件。
//   这样 .bat 可以立刻退出 → 黑窗口自动关；
//   日志照样有 → 启动失败时能看原因。

import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, '..');
const LOG = path.join(TOOL_ROOT, '启动日志.txt');

// 先把日志清空，免得上次的旧内容混进来
try {
  writeFileSync(LOG, '', 'utf8');
} catch {
  /* 写不了就算了，不影响启动 */
}

let fd;
try {
  fd = openSync(LOG, 'a');
} catch {
  fd = 'ignore';
}

const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), '--quiet'], {
  cwd: TOOL_ROOT,
  stdio: ['ignore', fd, fd],
  detached: true,
  windowsHide: true,
});

child.unref();
process.exit(0);
