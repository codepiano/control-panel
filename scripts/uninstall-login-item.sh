#!/usr/bin/env bash
set -euo pipefail

LABEL="com.codepiano.control-panel"
PLIST_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

# Disable future logins without terminating a panel started by this job.
launchctl disable "$DOMAIN/$LABEL"
rm -f "$PLIST_FILE"

echo "已停用登录时启动。"
