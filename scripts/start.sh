#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$PROJECT_ROOT/scripts"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"
LOG_FILE="$STATE_DIR/logs/control-panel.log"
NODE_BIN="${CONTROL_PANEL_NODE:-$(command -v node || true)}"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node.js not found. Install Node.js or set CONTROL_PANEL_NODE." >&2
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

LAUNCHER_PID="$("$NODE_BIN" - "$SCRIPT_DIR/run.sh" "$LOG_FILE" "$@" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [runner, log, ...args] = process.argv.slice(2);
const output = fs.openSync(log, 'a');
const child = spawn('/bin/bash', [runner, ...args], { detached: true, stdio: ['ignore', output, output], env: process.env });
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('spawn', () => { console.log(child.pid); child.unref(); fs.closeSync(output); });
NODE
)"
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
