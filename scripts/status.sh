#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "控制面板未运行。"
  exit 1
fi

LAUNCHER_PID="$(cat "$PID_FILE")"
if [[ -n "$LAUNCHER_PID" ]] && kill -0 "$LAUNCHER_PID" 2>/dev/null; then
  echo "控制面板运行中 (pid $LAUNCHER_PID)。"
  exit 0
fi

rm -f "$PID_FILE"
echo "控制面板未运行。"
exit 1
