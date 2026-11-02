@echo off
chcp 65001 >nul
title 文章管家 - 关掉这个窗口就停止

REM ============================================================
REM  Double-click to open the blog post manager.
REM
REM  What it does:
REM    1. Find node.exe / npm.cmd by absolute path (PATH may hold another)
REM    2. Start the blog dev server in a SEPARATE MINIMIZED window
REM       (skipped when port 4321 is already listening)
REM    3. Run the manager server in THIS window; it opens the browser
REM       once the port really answers
REM
REM  To STOP: close this window -> the manager stops.
REM  The blog keeps running in its own window; close that one too.
REM
REM  NOTE: comments below are ASCII on purpose. Chinese text inside
REM  REM lines breaks under code page 65001 (BUG-008): cmd.exe can
REM  swallow the REM prefix and then try to run the comment.
REM  Chinese IS fine inside echo lines.
REM
REM  NOTE: this file MUST keep CRLF line endings. With LF only,
REM  cmd.exe mis-parses every line and set/cd silently do nothing.
REM
REM  NOTE: no Chinese echo inside an ( ... ) block. Under code page
REM  65001 cmd counts bytes, not characters, so a line ending in a
REM  multi-byte char inside a block can bleed into the next line and
REM  that line gets executed as a command. Use labels (goto) instead.
REM ============================================================

setlocal

set "NODE=C:\Program Files\nodejs\node.exe"
set "NPM=C:\Program Files\nodejs\npm.cmd"

if not exist "%NODE%" (
    if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
    )
)

if not exist "%NPM%" (
    if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" (
        set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd"
    )
)

if not exist "%NODE%" (
    for /f "delims=" %%i in ('where node 2^>nul') do (
        set "NODE=%%i"
        goto :found
    )
)

:found
if not exist "%NODE%" (
    echo.
    echo   [ERROR] Node.js not found
    echo.
    echo   Please install Node.js first, then double-click this file again.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

REM ---- start the blog preview too (separate minimized window) ----
REM  Why a separate window: this window is blocked by the manager
REM  server, and one cmd window cannot host two long-running
REM  processes. Port check first, so double-clicking twice never
REM  starts a second dev server (they would fight over 4321).
REM  Labels instead of ( ) blocks: see the 65001 note above.
netstat -ano | findstr ":4321 " | findstr "LISTENING" >nul
if not errorlevel 1 goto :blog_running
if not exist "%~dp0site\node_modules" goto :blog_no_modules

echo   正在顺带启动博客预览（最小化窗口，约 10 秒就好）...
start "博客本地预览" /min /d "%~dp0site" "%NPM%" run dev
goto :blog_done

:blog_no_modules
echo   [提示] 没找到 site\node_modules，这次跳过博客预览。
echo          需要的话先在 site 目录跑一次 npm install。
goto :blog_done

:blog_running
echo   博客预览已经在运行，直接复用。

:blog_done

set "OPEN_BROWSER=1"

echo.
echo   文章管家启动中，浏览器会自动打开 http://127.0.0.1:5678/
echo   博客预览在另一个最小化的窗口里，地址 http://localhost:4321/
echo   关掉本窗口管家就停；博客那个窗口要单独关。
echo.

"%NODE%" "文章管家\src\server.mjs"

echo.
echo   已经停止了。按任意键关闭窗口。
pause >nul
