@echo off
chcp 65001 >nul
title 博客本地预览 - 关掉这个窗口就停止

REM ============================================================
REM  Double-click to preview the blog locally.
REM
REM  What it does:
REM    1. Locate npm (absolute path; PATH may hold another version)
REM    2. If port 4321 already serves the blog, just open a browser
REM    3. Otherwise run "npm run dev" in this window, and open the
REM       browser only after the server really answers
REM
REM  To STOP: close this window, or press Ctrl+C.
REM
REM  NOTE: comments below are ASCII on purpose. Chinese text inside
REM  REM lines breaks under code page 65001 (BUG-008): cmd.exe can
REM  swallow the REM prefix and then try to run the comment as a
REM  command. Chinese IS fine inside echo lines.
REM
REM  NOTE: this file MUST keep CRLF line endings. With LF only,
REM  cmd.exe mis-parses every line and set/cd silently do nothing.
REM ============================================================

setlocal

set "NPM=C:\Program Files\nodejs\npm.cmd"

if not exist "%NPM%" (
    if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" (
        set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd"
    )
)

if not exist "%NPM%" (
    echo.
    echo   [错误] 没找到 Node.js
    echo.
    echo   找过这两个位置：
    echo     C:\Program Files\nodejs\npm.cmd
    echo     C:\Program Files ^(x86^)\nodejs\npm.cmd
    echo.
    echo   请确认 Node.js 装了，或者打开这个 .bat 改一下 NPM 的路径。
    echo.
    pause
    exit /b 1
)

REM ---- always run from the site folder, wherever this bat lives ----
cd /d "%~dp0site"

if not exist "node_modules" (
    echo.
    echo   [错误] 没找到 site\node_modules
    echo.
    echo   依赖还没装好。请先执行：
    echo     cd site
    echo     npm install
    echo.
    pause
    exit /b 1
)

REM ---- already running? then only open the browser ----
netstat -ano | findstr ":4321 " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo.
    echo   博客已经在运行，直接打开浏览器：
    echo   http://localhost:4321/
    echo.
    start "" http://localhost:4321/
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

echo.
echo   ==============================================
echo     正在启动本地博客，请稍等几秒...
echo.
echo     浏览器会自动打开 http://localhost:4321/
echo     如果没有自动打开，手动把上面这个地址
echo     复制到浏览器里就行。
echo.
echo     要停止：关掉这个窗口，或按 Ctrl+C
echo   ==============================================
echo.

REM ---- open the browser only after the port answers ----
REM  A fixed delay is not enough: the first cold start has to
REM  compile the site. So poll the port instead (up to 60s) and
REM  open the browser as soon as it returns 200.
start "" powershell -NoProfile -WindowStyle Hidden -Command "$u='http://localhost:4321/'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ Start-Process $u; break } } catch {} ; Start-Sleep -Seconds 1 }"

call "%NPM%" run dev

echo.
echo   博客已停止。
pause
