@echo off
chcp 65001 >nul
title 文章管家 - 关掉这个窗口就停止

REM ============================================================
REM  Double-click to open the blog post manager.
REM
REM  What it does:
REM    1. Find node.exe by absolute path (PATH may hold another)
REM    2. Run the local server from 文章管家\src\server.mjs
REM    3. The server itself opens the browser once the port is
REM       really listening
REM
REM  To STOP: close this window, or press Ctrl+C.
REM
REM  NOTE: comments below are ASCII on purpose. Chinese text inside
REM  REM lines breaks under code page 65001 (BUG-008): cmd.exe can
REM  swallow the REM prefix and then try to run the comment.
REM  Chinese IS fine inside echo lines.
REM
REM  NOTE: this file MUST keep CRLF line endings. With LF only,
REM  cmd.exe mis-parses every line and set/cd silently do nothing.
REM ============================================================

setlocal

set "NODE=C:\Program Files\nodejs\node.exe"

if not exist "%NODE%" (
    if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
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
    echo   [错误] 没找到 Node.js
    echo.
    echo   这个工具是纯 Node 写的，需要先装 Node.js。
    echo   装好之后再双击这个文件。
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

set "OPEN_BROWSER=1"

echo.
echo   文章管家启动中，浏览器会自动打开 http://127.0.0.1:5678/
echo   关掉这个窗口就停止。
echo.

"%NODE%" "文章管家\src\server.mjs"

echo.
echo   已经停止了。按任意键关闭窗口。
pause >nul
