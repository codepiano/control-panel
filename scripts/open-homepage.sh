#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$PROJECT_ROOT/scripts/start.sh" --hidden
open "http://127.0.0.1:${CONTROL_PANEL_PORT:-4310}"
