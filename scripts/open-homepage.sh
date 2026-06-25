#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_FILE="$PROJECT_ROOT/control-panel.json"
PACKAGE_FILE="$PROJECT_ROOT/package.json"

read_json_field() {
  local file="$1"
  local expr="$2"
  [[ -f "$file" ]] || return 0

  node - "$file" "$expr" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const expr = process.argv[3];
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = Function('data', `return (${expr});`)(data);
  if (value && typeof value === 'object' && value.url) {
    process.stdout.write(String(value.url));
  } else if (value) {
    process.stdout.write(String(value));
  }
} catch {
  // Ignore malformed JSON and keep falling back.
}
NODE
}

resolve_homepage_from_manifest() {
  read_json_field "$MANIFEST_FILE" 'data.homepageUrl || data.homepage || data.projectUrl || data.url || ""'
}

resolve_homepage_from_package() {
  read_json_field "$PACKAGE_FILE" 'data.homepage || (data.repository && (typeof data.repository === "string" ? data.repository : data.repository.url)) || ""'
}

resolve_homepage_from_git() {
  local remote_url=""
  remote_url="$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true)"
  [[ -z "$remote_url" ]] && return 0

  case "$remote_url" in
    git@github.com:*) echo "https://github.com/${remote_url#git@github.com:}" | sed 's/\.git$//' ;;
    https://github.com/*) echo "$remote_url" | sed 's/\.git$//' ;;
    git@gitlab.com:*) echo "https://gitlab.com/${remote_url#git@gitlab.com:}" | sed 's/\.git$//' ;;
    https://gitlab.com/*) echo "$remote_url" | sed 's/\.git$//' ;;
    git@bitbucket.org:*) echo "https://bitbucket.org/${remote_url#git@bitbucket.org:}" | sed 's/\.git$//' ;;
    *) echo "$remote_url" | sed 's/\.git$//' ;;
  esac
}

HOMEPAGE_URL="$(resolve_homepage_from_manifest)"
[[ -z "$HOMEPAGE_URL" ]] && HOMEPAGE_URL="$(resolve_homepage_from_package)"
[[ -z "$HOMEPAGE_URL" ]] && HOMEPAGE_URL="$(resolve_homepage_from_git)"

if [[ -z "$HOMEPAGE_URL" ]]; then
  echo "Unable to determine project homepage." >&2
  exit 1
fi

open "$HOMEPAGE_URL"
echo "$HOMEPAGE_URL"
