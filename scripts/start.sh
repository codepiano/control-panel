#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$PROJECT_ROOT/scripts"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"
LOG_FILE="$STATE_DIR/logs/control-panel.log"
ELECTRON_BIN="$PROJECT_ROOT/node_modules/.bin/electron"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "electron binary not found. Run npm install first." >&2
  exit 1
fi

mkdir -p "$STATE_DIR/logs"

if [[ -f "$PID_FILE" ]]; then
  LAUNCHER_PID="$(cat "$PID_FILE")"
  if [[ -n "$LAUNCHER_PID" ]] && kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    echo "控制面板已在运行 (pid $LAUNCHER_PID)。"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup "$SCRIPT_DIR/run.sh" "$@" >"$LOG_FILE" 2>&1 &
LAUNCHER_PID=$!
echo "$LAUNCHER_PID" > "$PID_FILE"

sleep 1
if kill -0 "$LAUNCHER_PID" 2>/dev/null; then
  echo "控制面板已启动 (pid $LAUNCHER_PID)。"
  exit 0
fi

rm -f "$PID_FILE"
echo "控制面板启动失败。请查看 ${LOG_FILE}。" >&2
tail -n 40 "$LOG_FILE" >&2 || true
exit 1
