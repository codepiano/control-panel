#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PROJECT_ROOT/.control-panel"
PID_FILE="$STATE_DIR/control-panel.pid"
ELECTRON_BIN="$PROJECT_ROOT/node_modules/.bin/electron"
RUNNER_PID="$$"
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  if [[ -f "$PID_FILE" ]] && [[ "$(cat "$PID_FILE")" == "$RUNNER_PID" ]]; then
    rm -f "$PID_FILE"
  fi
}

trap cleanup EXIT INT TERM
cd "$PROJECT_ROOT"
"$ELECTRON_BIN" . "$@" &
APP_PID=$!
wait "$APP_PID"
