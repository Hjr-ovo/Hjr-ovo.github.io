@echo off
chcp 65001 >nul
title 博客管理工具

REM ============================================================
REM  双击这个文件就能启动博客管理工具
REM
REM  它做的事：
REM    1. 找到本机的 node（用完整路径，因为 PATH 里可能有别的版本）
REM    2. 启动工具的后端服务
REM    3. 后端启动后自己会打开浏览器到 http://127.0.0.1:5678
REM
REM  关掉这个黑窗口 = 关闭工具。
REM  （博客本身是另一个进程，不受影响 —— 用界面上的「打开博客」按钮控制它）
REM ============================================================

setlocal

REM ---- 找 node ----
REM 优先用系统安装的 Node（它带 npm，工具要用 npm 起 Astro）
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%NODE_EXE%" (
    REM 换个常见的安装位置试试
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
    echo   请确认 Node.js 装了，或者打开 .launch.bat 改一下 NODE_EXE 的路径。
    echo.
    pause
    exit /b 1
)

REM ---- 切到工具自己的目录（这样不管从哪里双击都能跑）----
cd /d "%~dp0"

REM ---- 启动 ----
"%NODE_EXE%" "src\server.mjs"

REM 工具退出（或出错）时别立刻关窗口，让你看得见报错
echo.
echo   工具已停止。
pause

endlocal
