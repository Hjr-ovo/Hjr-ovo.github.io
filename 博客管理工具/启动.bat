@echo off
chcp 65001 >nul
title 博客后台工具

REM ============================================================
REM  Double-click this file to start the blog tool.
REM
REM  What it does:
REM    1. Locate node.exe (absolute path; PATH may hold another ver)
REM    2. Start the tool backend on 127.0.0.1:5678
REM    3. The backend opens your browser automatically
REM    4. This window closes itself once the tool is up
REM
REM  Running it again while the tool is already open is safe:
REM  it will just bring the browser window back, no second copy.
REM
REM  To STOP the tool, use the "quit tool" button in the web UI.
REM
REM  NOTE: comments below are ASCII on purpose. Chinese text in
REM  REM lines breaks under code page 65001 (see BUG-008), because
REM  cmd.exe can swallow the REM prefix and then try to run the
REM  comment as a command. Chinese IS fine inside echo lines.
REM
REM  NOTE: this file MUST keep CRLF line endings. With LF only,
REM  cmd.exe mis-parses every line and set/cd silently do nothing
REM  (see BUG-008).
REM ============================================================

setlocal

REM ---- locate node ----
REM Prefer the system-installed Node (it ships npm, needed by Astro)
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%NODE_EXE%" (
    if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
    )
)

if not exist "%NODE_EXE%" (
    echo.
    echo   [错误] 没找到 Node.js
    echo.
    echo   找过这两个位置：
    echo     C:\Program Files\nodejs\node.exe
    echo     C:\Program Files ^(x86^)\nodejs\node.exe
    echo.
    echo   请确认 Node.js 装了，或者打开这个 .bat 改一下 NODE_EXE 的路径。
    echo.
    pause
    exit /b 1
)

REM ---- always run from the tool's own folder ----
cd /d "%~dp0"

REM ---- start the tool detached, then close this window ----
REM
REM Use PowerShell's Start-Process so the tool is NOT a child of
REM this console: cmd can then exit (and the window disappear)
REM while the tool keeps running in the background.
REM
REM IMPORTANT: do NOT add -RedirectStandardOutput / -RedirectStandardError
REM here. Those make Start-Process wait for the child to finish, so this
REM script never exits and the window never closes (see BUG-010).
REM
REM Logging is handled by src\launch.mjs instead: it is a tiny wrapper
REM that spawns the real server and points its output at the log file.
REM That keeps the log AND lets this window close.

set "LOG=%~dp0启动日志.txt"

powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'src\launch.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

REM A short pause so the tool can grab the port and write its log.
REM `timeout` is avoided on purpose: when stdout is not a real console
REM (e.g. launched by a script) it errors out with
REM "Input redirection is not supported". `ping` has no such issue.
ping -n 4 127.0.0.1 >nul

REM If the tool failed to come up, keep the window so the reason shows.
REM Success = the port answers. (Checked via PowerShell, which can
REM speak HTTP without extra tools.)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5678/api/hello' -UseBasicParsing -TimeoutSec 3; exit 0 } catch { exit 1 }"

if errorlevel 1 (
    echo.
    echo   启动失败，下面是原因：
    echo   ----------------------------------------
    if exist "%LOG%" type "%LOG%"
    echo   ----------------------------------------
    echo.
    echo   日志文件： %LOG%
    echo.
    pause
    exit /b 1
)

exit /b 0
