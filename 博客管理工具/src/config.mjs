// 配置：所有"环境相关"和"路径相关"的东西集中在这里
//
// 为什么单独一个文件：
//   这台机器有几个特殊之处（npm 不在 PATH 里、路径带中文），
//   散落在各个文件里改起来会漏。集中一处，换电脑只改这里。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件所在目录：博客管理工具/src/
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 工具根目录：博客管理工具/
export const TOOL_ROOT = path.resolve(__dirname, '..');

// 仓库根目录：D:\file\myblogweb
export const REPO_ROOT = path.resolve(TOOL_ROOT, '..');

// Astro 项目目录：D:\file\myblogweb\site
export const SITE_ROOT = path.join(REPO_ROOT, 'site');

// ★ 文章目录 —— 工具真正操作的地方
export const POSTS_DIR = path.join(SITE_ROOT, 'src', 'content', 'posts');

// 删除文章的备份目录（落在 .workbuddy/ 里，已被 .gitignore 整块忽略）
export const BACKUP_DIR = path.join(REPO_ROOT, '.workbuddy', 'tmp', 'deleted-posts');

// ★ 改名重定向表 —— 记录「旧文件名 → 新文件名」。
//   静态站没有服务端，改名后旧链接会直接 404；
//   这张表让 Astro 在构建时给旧地址生成一个跳转页（见 技术架构.md 5.5.2）。
//   文件在 site/src/data/ 下，**属于站点源码，要进 git**。
export const REDIRECTS_FILE = path.join(SITE_ROOT, 'src', 'data', 'redirects.json');

// 博客进程号的记录文件。
// 作用：管理工具启动博客后把进程号写在这里，这样即使管理工具自己重启过，
// 也还能找到那个博客进程并把它关掉（光靠内存记不住）。
export const BLOG_PID_FILE = path.join(REPO_ROOT, '.workbuddy', 'tmp', 'blog.pid');

// ---------------- 端口 ----------------

// 工具自己的端口
export const TOOL_PORT = 5678;

// 工具只监听本机。理由见 技术架构.md 第六节第 9 条：
// 只给自己用，不需要局域网访问，减少暴露面。
//
// ⚠️ 用 127.0.0.1 而不是 localhost：
//    localhost 可能先解析到 IPv6 的 ::1，而这里只绑了 IPv4，
//    于是"浏览器能开、程序连不上"。实测踩过地址族的坑（BUG-007）。
export const TOOL_HOST = '127.0.0.1';

// 工具自己的地址（启动提示、打开浏览器、单实例探测都用它）
export const TOOL_BASE_URL = `http://${TOOL_HOST}:${TOOL_PORT}/`;

// Astro 开发服务器端口（Astro 默认就是 4321）
export const ASTRO_PORT = 4321;

// ---------------- 外部命令 ----------------

// ⚠️ 这里有个 Windows 上的坑，实测踩过（2026-09-20）：
//
//   直接 spawn('C:\Program Files\nodejs\npm.cmd', ['run','dev'], { shell: true })
//   会失败，报 `'C:\Program' 不是内部或外部命令` ——
//   因为路径里有空格，cmd.exe 把 "C:\Program" 当成了一个命令。
//
// 所以改成**直接用 node 执行 npm 的入口脚本**（npm-cli.js）：
//   绕开 cmd.exe，没有 shell 解析，空格路径也不再是问题。
//
// 顺带的好处：这样调起来更快，也更容易拿到干净的输出。

// 本机的 node 解释器（系统装的，带 npm）
export const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';

// npm 的入口脚本（用 node 直接跑它，等价于敲 npm 命令）
export const NPM_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

// ---------------- 站点信息 ----------------

// 博客首页地址（"一键打开博客"按钮跳这里）
export const BLOG_URL = `http://localhost:${ASTRO_PORT}/`;

// 文章 URL 前缀。URL 结构是 /posts/<文件名>/，不带分类（ADR-006）
export const POST_URL_PREFIX = '/posts/';

// ---------------- 分类清单 ----------------

// 起步主题清单，来自 需求与目标.md「分类体系」一节。
// ⚠️ 这不是定稿 —— 需求里写明"前期鼓励频繁调整"，所以界面上允许手填新分类。
export const CATEGORIES = [
  '计算机网络',
  '操作系统',
  '计算机组成',
  '数据结构与算法',
  '数据库',
  '编程语言',
  '开发工具',
  '项目实践',
];
