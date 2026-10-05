#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"
NODE_BIN="${CONTROL_PANEL_NODE:-$(command -v node || true)}"
RUNNER_PID="$$"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [[ -f "$PID_FILE" ]] && [[ "$(cat "$PID_FILE")" == "$RUNNER_PID" ]]; then
    rm -f "$PID_FILE"
  fi
}

trap cleanup EXIT INT TERM
cd "$PROJECT_ROOT"
"$NODE_BIN" "$PROJECT_ROOT/src/server.js" "$@" &
SERVER_PID=$!
wait "$SERVER_PID"
