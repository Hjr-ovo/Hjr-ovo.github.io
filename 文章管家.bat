@echo off
chcp 65001 >nul

REM ============================================================
REM  Double-click to open the blog post manager.
REM
REM  It runs WITHOUT a console window: this bat hands the job to
REM  launch-hidden.vbs, which re-runs the same file with
REM  "--run --hidden" in a window that is never shown.
REM
REM  Need the black window back (to read errors / logs)?
REM      cmd /c 文章管家.bat --run
REM  Without --hidden the pauses and echoes stay, and the window
REM  closes only when you press a key.
REM
REM  To STOP: close the browser tab, or press the button at the top
REM  right of the page. Either one shuts the manager AND the blog
REM  preview down (the manager owns the dev server it started).
REM
REM  NOTE: comments below are ASCII on purpose. Chinese text inside
REM  a REM line breaks under code page 65001 (BUG-008): cmd.exe can
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

if /i "%~1"=="--run" goto :run

REM ---- normal double-click: relaunch hidden, then get out -----
REM If the launcher went missing, fall through to a normal visible run
REM rather than dying silently.
if not exist "%~dp0launch-hidden.vbs" goto :run
REM wscript.exe has no console of its own, so the copy it starts is
REM genuinely invisible (not even a taskbar button). The vbs waits
REM for that copy to exit so it can report a failed start.
wscript //nologo "%~dp0launch-hidden.vbs" "%~f0"
if errorlevel 1 goto :no_wscript
exit /b 0

:no_wscript
echo.
echo   [ERROR] launch-hidden.vbs could not be started.
echo   Run this file with --run to see the details.
echo.
pause
exit /b 1

:run
REM ---- real work starts here -----------------------------------
setlocal
set "HIDDEN=0"
if /i "%~2"=="--hidden" set "HIDDEN=1"

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
    call :hold
    exit /b 1
)

cd /d "%~dp0"

REM ---- start the blog preview too (separate minimized window) ----
REM  Why a separate window: this process is taken by the manager
REM  server, and one cmd window cannot host two long-running
REM  processes. Port check first, so double-clicking twice never
REM  starts a second dev server (they would fight over 4321).
REM  Labels instead of ( ) blocks: see the 65001 note above.
netstat -ano | findstr ":4321 " | findstr "LISTENING" >nul
if not errorlevel 1 goto :blog_running
if not exist "%~dp0site\node_modules" goto :blog_no_modules

echo   正在顺带启动博客预览（无窗口，约 10 秒就好）...
REM Hidden too: the script host has no console of its own, so the dev
REM server leaves nothing on screen either. Third arg = working directory.
wscript //nologo "%~dp0launch-hidden.vbs" "%NPM%" blog "%~dp0site"
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
echo   博客预览已经在后台起来了，地址 http://localhost:4321/
echo   停止：点页面右上角的「退出」，或者直接把浏览器标签关掉。
echo.

"%NODE%" "文章管家\src\server.mjs"
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" echo   启动失败（退出码 %CODE%）。
if "%CODE%"=="0" echo   已经停止了。
call :hold
exit /b %CODE%

REM ---- helpers -------------------------------------------------
:hold
REM Hidden runs have no window to press a key in: bail out instead
REM of waiting forever (the vbs would block on us).
if "%HIDDEN%"=="1" exit /b 0
echo   按任意键关闭窗口。
pause >nul
exit /b 0
