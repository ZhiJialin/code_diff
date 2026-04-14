@echo off
cd /d "%~dp0"

echo 正在停止 GitLab Diff Viewer...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo 已终止进程 PID: %%a
)

timeout /t 1 /nobreak >nul
echo 重新启动 GitLab Diff Viewer...
node server.js
pause
