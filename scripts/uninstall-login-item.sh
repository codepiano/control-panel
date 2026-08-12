#!/usr/bin/env bash
set -euo pipefail

LABEL="com.codepiano.control-panel"
PLIST_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_FILE"

echo "已停用登录时启动。"
