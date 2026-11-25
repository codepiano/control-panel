#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.codepiano.control-panel"
PLIST_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
EXPECTED_SCRIPT="$PROJECT_ROOT/scripts/login-start.js"
DOMAIN="gui/$(id -u)"

if [[ ! -f "$PLIST_FILE" ]]; then
  echo "disabled"
  exit 1
fi

CONFIGURED_SCRIPT="$(plutil -extract ProgramArguments.1 raw -o - "$PLIST_FILE" 2>/dev/null || true)"
CONFIGURED_NODE="$(plutil -extract ProgramArguments.0 raw -o - "$PLIST_FILE" 2>/dev/null || true)"

if [[ "$CONFIGURED_SCRIPT" != "$EXPECTED_SCRIPT" || ! -x "$CONFIGURED_NODE" ]]; then
  echo "stale"
  exit 2
fi

if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "not-loaded"
  exit 3
fi

echo "enabled"
exit 0
