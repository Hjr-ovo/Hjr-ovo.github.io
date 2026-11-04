@echo off
chcp 65001 >nul
title 推送到 GitHub

cd /d "%~dp0"

git push
if errorlevel 1 goto fail

echo.
echo 推送成功。GitHub 会自动构建发布，约 1-2 分钟后线上生效。
echo.
pause
exit /b 0

:fail
echo.
echo 推送失败，原因见上面的 git 输出。
echo.
pause
exit /b 1
