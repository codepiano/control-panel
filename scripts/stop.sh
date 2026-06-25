#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "控制面板未运行。"
  exit 0
fi

LAUNCHER_PID="$(cat "$PID_FILE")"
if [[ -z "$LAUNCHER_PID" ]] || ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "控制面板未运行。"
  exit 0
fi

kill "$LAUNCHER_PID" 2>/dev/null || true
for _ in {1..20}; do
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "控制面板已停止。"
    exit 0
  fi
  sleep 0.2
done

kill -9 "$LAUNCHER_PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "控制面板已停止。"
