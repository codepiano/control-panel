#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.codepiano.control-panel"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCH_AGENTS_DIR/$LABEL.plist"
TEMP_FILE="$PLIST_FILE.$$.tmp"
LOG_DIR="$PROJECT_ROOT/.control-panel/logs"
DOMAIN="gui/$(id -u)"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT

plutil -create xml1 "$TEMP_FILE"
plutil -insert Label -string "$LABEL" "$TEMP_FILE"
plutil -insert ProgramArguments -array "$TEMP_FILE"
plutil -insert ProgramArguments.0 -string "/bin/bash" "$TEMP_FILE"
plutil -insert ProgramArguments.1 -string "$PROJECT_ROOT/scripts/start.sh" "$TEMP_FILE"
plutil -insert ProgramArguments.2 -string "--hidden" "$TEMP_FILE"
plutil -insert WorkingDirectory -string "$PROJECT_ROOT" "$TEMP_FILE"
plutil -insert RunAtLoad -bool true "$TEMP_FILE"
plutil -insert ProcessType -string "Interactive" "$TEMP_FILE"
plutil -insert StandardOutPath -string "$LOG_DIR/login-item.log" "$TEMP_FILE"
plutil -insert StandardErrorPath -string "$LOG_DIR/login-item.log" "$TEMP_FILE"

if [[ -n "${CONTROL_PANEL_CONFIG:-}" ]]; then
  plutil -insert EnvironmentVariables -dictionary "$TEMP_FILE"
  plutil -insert EnvironmentVariables.CONTROL_PANEL_CONFIG -string "$CONTROL_PANEL_CONFIG" "$TEMP_FILE"
fi

plutil -lint "$TEMP_FILE" >/dev/null
chmod 600 "$TEMP_FILE"

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
mv "$TEMP_FILE" "$PLIST_FILE"
launchctl bootstrap "$DOMAIN" "$PLIST_FILE"

echo "已启用登录时启动：$PLIST_FILE"
