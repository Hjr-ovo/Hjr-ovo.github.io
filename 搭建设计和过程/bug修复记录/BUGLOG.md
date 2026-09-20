# bug 修复记录

> 一个 bug 一张卡片，编号 `BUG-001` 起递增。
> **根因** = 这次为什么错；**反思** = 下次怎么不错。两者必须分开写。

## 卡片模板

```text
## BUG-XXX 一句话描述问题

- 发现时间：
- 现象：看到什么样
- 复现步骤：1.  2.  3.
- 报错信息：（贴控制台 / 终端原文）
- 定位过程：怎么一步步找到原因的
- 根因：这次为什么错
- 修复：改成了什么
- 涉及文件：
- 验证：怎么确认修好了
- 反思：下次怎么不错
- 状态：待修复 / 已修复 / 待观察
```

---

<!-- 新 bug 追加在下面，最新的放最上面 -->

## BUG-002 npm install 卡死 23 分钟（esbuild 安装脚本失败后挂起）

- 发现时间：2026-09-19 19:14（约 18:51 开始，跑满 23 分钟后确认）
- 现象：
  1. `npm create astro@latest` 报 `▲ error Error: Timeout`，提示「Dependencies failed to install, please run npm install manually」
  2. 手动 `npm install` 补装，跑了 **23 分钟毫无进展**：没有输出、文件不再变化
- 复现步骤：1. 进入 `site/` 2. 执行 `npm install` 3. 等到 esbuild 的安装脚本阶段
- 报错信息：npm 调试日志末尾仅一行
  `info run esbuild@0.28.2 postinstall { code: 1, signal: null }`
  —— 此后**再无任何输出**，进程就这么挂着
- 定位过程：
  1. **先排除"网络慢"**：查 `node_modules` 已下到 98.4 MB，`astro`、`vite`、`sharp` 均已就位 → 不是没在下载
  2. **冻结检测**：间隔 10 分钟对比四项可观测指标 —— 顶层条目数（173 / 173）、总体积（98.4 MB / 98.4 MB）、最近 3 分钟内被修改文件数（0）、node 进程 CPU 累计（数值完全未变）→ **四项全部零变化，判定为挂起，不是慢**
  3. **翻 npm 调试日志**（`%LOCALAPPDATA%\npm-cache\_logs\`），末尾正停在 esbuild 的 postinstall 返回 code 1
  4. **验证平台二进制**：`node_modules/@esbuild/win32-x64/esbuild.exe` **存在**（二进制没问题），但 `node_modules/esbuild` 是**空目录**（包本体没解压进去）
- 根因：**esbuild 的安装脚本（postinstall）执行失败（code 1）后，npm 没有终止进程，而是挂起等待** —— 表现成"无输出、文件不动"的假死状态。
  而这个脚本其实并非必需：esbuild 的平台二进制由独立包 `@esbuild/win32-x64` 提供，该包已装好。
  - 附带观察（**未证实，留待观察**）：`site/package.json` 里出现了一个 `allowScripts` 字段（`{"esbuild": true}`），并非常规 npm 字段，怀疑与 npm 11.12 的安装脚本策略有关
- 修复：清掉 `node_modules` 与 `package-lock.json`，改用 `npm install --ignore-scripts` 重装，**跳过所有安装脚本**。
  本项目依赖均使用预编译二进制，没有 node-gyp 那种"现场编译"的需求，跳过是安全的
- 涉及文件：`site/package.json`、`site/node_modules/`、`site/package-lock.json`
- 验证：✅ 已通过
  - `npm install --ignore-scripts` → `added 193 packages in 4m`
  - `npm run build` → `1 page(s) built in 1.69s`，产出 `dist/index.html`（1832 字节）
  - 之前缺失的 `space-separated-tokens/index.js` 已存在
- 连带发现（**第二个坑，同一轮踩到**）：`Remove-Item node_modules -Recurse -Force` **删不干净** ——
  Windows 长路径限制会让部分文件残留，导致"删过了但其实没删完"，npm 于是在一个半残目录上做增量，
  结果 `node_modules/esbuild` 空目录、`space-separated-tokens` 缺 `index.js`，`astro build` 报
  `ERR_MODULE_NOT_FOUND`。**可靠清空办法**：`robocopy <空目录> node_modules /MIR`（镜像空目录），
  再 `Remove-Item`。robocopy 不受长路径限制，几秒完成
- 反思：**「命令没有输出」不等于「它在慢慢干活」。** 判断一个长任务是真的在推进还是已经卡死，必须看可观测的副作用（文件数、体积、进程 CPU 增量），不能靠"再等等看"。
  这次用「间隔 10 分钟四项指标零变化」当判据，比盲等有效得多 —— 23 分钟里如果能早点做这个对比，能省下十几分钟
- 反思（第二条）：**「删除命令没报错」不等于「删干净了」。** 在 Windows 上清理 `node_modules` 这类
  海量小文件目录，`Remove-Item` 会因长路径静默失败一部分。这类操作要换用 `robocopy /MIR` 这种
  为路径长度而生的工具，并且**删完必须验证**（数条目、看大小是否为 0）
- 状态：已修复（`--ignore-scripts` 已固化为本项目安装依赖的固定参数）

## BUG-001 把临时文件提交进了版本库

- 发现时间：2026-09-19 17:52
- 现象：提交 `16e61af` 的明细里出现 `create mode 100644 _tmp_out.txt` —— 一个本该被忽略的命令行输出文件被收进了版本库
- 复现步骤：1. 在仓库根目录生成 `_tmp_out.txt` 2. `git add -A` 3. `git commit`
- 报错信息：**没有任何报错**，静默误入。只有翻看提交明细才发现
- 定位过程：查 `.gitignore`，发现规则写的是 `_git*.txt`，只匹配 `_git` 开头的文件；这次临时文件改名叫 `_tmp_out.txt`，就不匹配了。规则靠"猜文件名前缀"来兜，命名一换必然失效
- 根因：临时文件放在仓库根目录，却靠 `.gitignore` 逐条列举文件名来排除。**排除范围取决于名字，而名字是我随手起的**
- 修复：
  1. 从版本库移除该文件（`git rm --cached`），文件本身删除
  2. `.gitignore` 增加 `/_*.txt`、`/_*.log` —— 带前导斜杠，只作用于仓库根目录，不会误伤子目录
  3. **改变约定：AI 的临时输出一律写到 `.workbuddy/tmp/`**，该目录已被整块忽略，无需再逐条列举
- 涉及文件：`.gitignore`、`_tmp_out.txt`
- 验证：`git status` 干净；`git check-ignore -v` 能命中新规则
- 反思：**凡是"靠列举名字来排除"的规则，都会随命名变化静默失效。** 要么把文件放进一个已被整体忽略的目录，要么用通配符覆盖整整一类，别一个一个点名
- 状态：已修复
