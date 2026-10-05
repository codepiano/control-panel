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
PORT="${CONTROL_PANEL_PORT:-4310}"
echo "控制面板 · 后台启动"
echo "  访问地址：http://127.0.0.1:$PORT/"
echo "  项目目录：$PROJECT_ROOT"
echo "  Node：$NODE_BIN ($("$NODE_BIN" --version))"
echo "  日志文件：$LOG_FILE"

if [[ -f "$PID_FILE" ]]; then
  LAUNCHER_PID="$(cat "$PID_FILE")"
  COMMAND="$(ps -p "$LAUNCHER_PID" -o command= 2>/dev/null || true)"
  if [[ "$LAUNCHER_PID" =~ ^[0-9]+$ ]] && kill -0 "$LAUNCHER_PID" 2>/dev/null && [[ "$COMMAND" == *"$SCRIPT_DIR/run.sh"* ]]; then
    echo "控制面板已在运行，正在确认 HTTP 服务就绪…"
    if "$NODE_BIN" "$SCRIPT_DIR/startup-info.js" "$LAUNCHER_PID"; then exit 0; fi
    echo "无法确认已有服务就绪。日志尾部：" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    exit 1
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

echo "  启动进程：$LAUNCHER_PID"
echo "正在等待 HTTP 服务就绪（最多 60 秒）…"
if "$NODE_BIN" "$SCRIPT_DIR/startup-info.js" "$LAUNCHER_PID"; then
  exit 0
fi

if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then rm -f "$PID_FILE"; fi
echo "控制面板未能确认就绪（进程仍存在时可用 status.sh 检查）。请查看 ${LOG_FILE}。" >&2
tail -n 40 "$LOG_FILE" >&2 || true
exit 1
