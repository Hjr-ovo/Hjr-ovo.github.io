---
title: npm install 卡死 23 分钟：一次 esbuild 安装脚本导致的假死
description: Windows 上 npm install 没有任何输出也不报错，进程就这么挂着。记录怎么判断它是真在干活还是已经死了，以及为什么加 --ignore-scripts 就好了。
pubDate: 2026-09-19
updatedDate: 2026-09-20
categories: [开发工具]
tags: [npm, Windows, 踩坑]
draft: false
---

## 环境

- Windows 11
- Node.js v24.15.0（`C:\Program Files\nodejs\`）
- npm 11.12.1
- 目标：用 `create-astro` 起一个 Astro 项目

## 现象

脚手架跑到一半报超时，提示依赖没装上，让手动补装：

```
▲ error Error: Timeout
Dependencies failed to install, please run npm install manually
```

于是进目录手动跑 `npm install`。然后它就这么挂着 —— **跑了 23 分钟，没有任何输出，文件也不再变化**。

## 先说结论

两件事，都跟你想的可能不一样：

1. **它不是慢，是死了。** npm 在 esbuild 的安装脚本失败后退出了"干活"状态，但进程没结束
2. **删 `node_modules` 也可能没删干净。** 这是同一轮踩到的第二个坑，见下文

## 怎么判断"卡死"而不是"慢"

这是这次最值得记的一条。**没有输出 ≠ 还在干活。**

当时选了几个"会随进度变化"的指标，隔 10 分钟对比了两次：

| 指标 | 怎么取 | 结果 |
|---|---|---|
| `node_modules` 顶层条目数 | `(Get-ChildItem node_modules).Count` | 173 → 173 |
| 总体积 | `Measure-Object -Property Length -Sum` | 98.4 MB → 98.4 MB |
| 最近 3 分钟内被修改的文件数 | 按 `LastWriteTime` 过滤 | 0 |
| node 进程累计 CPU 时间 | `Get-Process node \| Select CPU` | 数值完全未变 |

**四项全部零变化 → 判定为挂起，不是慢。**

> 如果早点做这个对比，能省下十几分钟。盲等是最贵的排查方式。

## 找到停在哪一步

npm 的调试日志在 `%LOCALAPPDATA%\npm-cache\_logs\`，翻最后几行：

```
info run esbuild@0.28.2 postinstall { code: 1, signal: null }
```

到这里就没有下文了 —— esbuild 的 `postinstall` 脚本**执行失败（返回码 1）**，然后 npm 就挂在那儿等。

再去看装出来的东西：

- `node_modules/@esbuild/win32-x64/esbuild.exe` —— **存在**，平台二进制没问题
- `node_modules/esbuild` —— **是个空目录**，包本体根本没解压进去

也就是说，**那个失败的安装脚本其实不是必需的**：esbuild 的真正二进制由独立包 `@esbuild/win32-x64` 提供，而那个包已经装好了。

## 修复

清掉依赖，跳过所有安装脚本重装：

```bash
npm install --ignore-scripts
```

结果正常：

```
added 193 packages in 4m
```

> **为什么跳过脚本是安全的**：本项目依赖都用预编译好的二进制，没有 node-gyp 那种"在本地现场编译"的需求。
> 如果你的项目里有需要编译的原生模块，这条要谨慎。

## 顺带踩到的第二个坑：删除没删干净

清 `node_modules` 时用的是 `Remove-Item -Recurse -Force`。**它不报错，但没删完** —— Windows 的长路径限制会让一部分深路径的文件静默残留。

后果是 npm 在一个"半残目录"上做增量安装，最终：

```
ERR_MODULE_NOT_FOUND: Cannot find module '.../space-separated-tokens/index.js'
```

**排查方向一度跑偏**，怀疑是 `--ignore-scripts` 导致的。实际根因是删得不干净。

**可靠做法**：用 `robocopy` 把空目录镜像过去，它不受长路径限制。

```powershell
New-Item -ItemType Directory -Path _empty -Force
robocopy _empty node_modules /MIR
Remove-Item node_modules -Recurse -Force
Remove-Item _empty -Recurse -Force
```

> **删完要验证**：数条目、看大小是不是 0。别只看命令有没有报错 —— 它这次就没报错。

## 沉淀下来的两条规则

1. **判断一个没有输出的长任务，看"可观测副作用有没有变化"，不看"等了多久"**
2. **Windows 上删海量小文件目录，用 `robocopy /MIR`，并且删完必须验证**

现在这个项目装依赖固定带 `--ignore-scripts`，`node_modules` 出问题一律用 `robocopy` 清空。
