@echo off
chcp 65001 >nul
title Blog Tool

REM ============================================================
REM  Double-click this file to start the blog tool.
REM
REM  What it does:
REM    1. Locate node.exe (absolute path; PATH may hold another ver)
REM    2. Start the tool backend on 127.0.0.1:5678
REM    3. The backend opens your browser automatically
REM
REM  Closing the black window stops the tool.
REM  (The blog itself is a separate process -- use the
REM   "open blog" button inside the tool to control it.)
REM
REM  NOTE: the comments below are ASCII on purpose. Chinese text
REM  inside REM lines breaks under code page 65001 (see BUG-008),
REM  because cmd.exe can swallow the REM prefix and then try to
REM  run the comment as a command. Chinese IS fine in echo lines.
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

REM ---- start the tool ----
"%NODE_EXE%" "src\server.mjs"

REM Keep the window open on exit so any error stays visible.
echo.
echo   工具已停止。
pause

endlocal
