#!/bin/bash
cd "$(dirname "$0")"

echo "正在停止 GitLab Diff Viewer..."

if command -v lsof &>/dev/null; then
  PID=$(lsof -ti:3000 2>/dev/null)
  if [ -n "$PID" ]; then
    kill -9 $PID
    echo "已终止进程 PID: $PID"
  else
    echo "未发现运行中的进程"
  fi
else
  # Windows Git Bash: use netstat + taskkill
  PIDS=$(netstat -ano 2>/dev/null | grep ":3000 " | grep "LISTENING" | awk '{print $5}' | sort -u)
  if [ -n "$PIDS" ]; then
    for PID in $PIDS; do
      taskkill //F //PID "$PID" >/dev/null 2>&1
      echo "已终止进程 PID: $PID"
    done
  else
    echo "未发现运行中的进程"
  fi
fi

sleep 1
echo "重新启动 GitLab Diff Viewer..."
node server.js
