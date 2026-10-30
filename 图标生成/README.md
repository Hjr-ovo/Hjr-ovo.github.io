# 图标生成说明（博客本体 + 后台管理工具）

阿然的手绘头像（`logo.png`，1224×1244，白/暖白纸底 RGB）一套图标，
同时供给 **博客站点** 和 **后台管理工具**。产物由脚本一次产出，
**改 `logo.png` 后必须重跑脚本**，不要手改产物文件（会被覆盖）。

## 一键重新生成

```powershell
& "C:\Users\20138\.workbuddy\binaries\python\envs\default\Scripts\python.exe" "D:\file\myblogweb\图标生成\generate-icons.py"
& "C:\Users\20138\.workbuddy\binaries\python\envs\default\Scripts\python.exe" "D:\file\myblogweb\图标生成\make-shortcut.py"
```

依赖：Pillow（已装在上述 venv）。`make-shortcut.py` 只用标准库。

## 产物落位

| 文件 | 用途 |
|---|---|
| `site/public/favicon.ico` | 博客标签页图标（16/32/48/64 四档） |
| `site/public/favicon.png` | 现代浏览器 PNG favicon（512） |
| `site/public/apple-touch-icon.png` | iOS「添加到主屏」（180） |
| `site/public/icon-192.png` / `icon-512.png` | Android Chrome / PWA（192/512） |
| `图标生成/app.ico` | Windows 快捷方式大图标（16/32/48/64/128/256） |
| `桌面\博客.lnk` | 一键启动本地博客（指向根目录 `预览.bat`） |

> 2026-10-30：博客后台工具已删除，原先它那套 favicon（`博客后台工具/public/`）
> 和 `app.ico` 一起消失。现在 `app.ico` 就地产在 `图标生成/` 下，只给
> 桌面«博客»快捷方式用；快捷方式目标改为根目录的 `预览.bat`。

旧文件 `site/public/favicon.svg`（早期自绘矢量图形）**已删除**，
`BaseLayout.astro` 里的 svg 引用同步移除——不删的话支持 svg favicon 的
浏览器会显示旧图案，与新的位图图标不一致。

## 关键参数

- **背景色**：原图纸底约 `#F0EDE9`（暖白），非纯白；favicon 在浏览器
  深色标签页上会显示为一块暖白方块，这是「用原图当图标」的固有表现。
- **小尺寸裁切 `SMALL_CROP_RATIO = 0.88`**（仅 ≤64px 生效）：
  原图带大面积纸纹留白，且纸纹蔓延到画布边缘，自动包围盒会把边缘
  装饰也框进来，所以用固定比例居中裁。0.88 裁后主体约占 91%，
  四周仍留约 2% 安全边，切不到丸子头顶发和下巴。
  ⚠️ **换 `logo.png` 后必须人工复核这个比例。**
- **分档锐化**：≥64px 轻锐（45%）、32–63px 中锐（70%）、≤16px 重锐（90%）——
  位图缩到 16px 必然发软，不锐化等于糊成一团色块。

## 为什么 ICO 要自己拼容器

Pillow 的 ICO 保存只接受一张母图，再按 `sizes` 逐档 `resize`——
等于把 512 的完整图硬缩到 16px，分档裁切和锐化全部白做，
产出的文件只有几百字节（假多尺寸）。`write_ico()` 按规范逐档嵌入：
**<128px 走 BMP(DIB)（BGRA、自底向上、`biHeight` 写两倍），≥128px 走 PNG**。
脚本内置验收：从 ico 取出的每一帧必须与独立生成的 PNG 逐像素一致。

## 为什么快捷方式手写 .lnk

本环境工具安全策略拦截 COM 实例化（`WScript.Shell`）和 LOLBin，
`make-shortcut.py` 按 MS-SHLLINK 规范纯 `struct` 拼字节：
76 字节 Header（注意有 Reserved3，官方 HeaderSize 才是 0x4C）+
RelativePath / WorkingDir / IconLocation 三个字符串块（GBK 编码，
不设 IsUnicode flag 时按系统 ANSI 代码页解释）。
生成后脚本会读回来自检三个字段。

## 验收记录（2026-10-15）

- 三个 ico 逐帧与 PNG 比对一致（脚本 assert 全过）
- 16/32/64px 放大 15 倍贴白/浅灰/深三色底目检：16px 可辨认、
  32px 清晰、64px 优秀，裁切未伤主体
- 桌面快捷方式三个字段读回一致
