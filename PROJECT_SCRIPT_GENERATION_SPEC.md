# Project Script Generation Spec

Version: `1.3`

This document is the canonical contract for any AI that generates or repairs project control scripts for a repository managed by Control Panel.

The goal is simple:

- Given a project repository or project directory
- Given the spec in this file
- Generate the minimum set of scripts and manifest fields needed to initialize, install, start, stop, inspect, and remove that project on macOS

If anything in the repository conflicts with this spec, the repository can adapt, but the final output must still follow the rules below.

## 1. Scope

This spec covers:

- Discovering a project’s runtime entrypoints
- Generating `init`, `install`, `start`, `stop`, `status`, `restart`, `uninstall`, and optional homepage scripts
- Respecting project-authored scripts when they already exist
- Updating `control-panel.json`
- Making scripts safe, repeatable, and executable on macOS
- Producing a machine-readable change set or patch that can be applied directly

This spec does not cover:

- Building a full deployment system
- Designing a UI
- Managing multiple machines
- Remote orchestration unless the project itself already depends on it

## 2. Inputs

An AI using this spec should assume the following inputs may be available:

- `projectRoot`: the filesystem root of the project
- `control-panel.json`: the project manifest, if already present
- `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `docker-compose.yml`, `Makefile`, or similar project files
- `scripts/` directory, if already present
- A human-provided spec URL or documentation link, if attached to the project session

If the AI can inspect the repository directly, it should do so.
If it only receives text, it should ask for the minimum missing files needed to avoid guessing.

## 3. Project Manifest Contract

Every controllable project should be representable by a `control-panel.json` file at the project root.

### 3.1 Required fields

- `name`: display name for the project
- `workingDirectory`: working directory used for commands, usually `"."`

### 3.2 Optional fields

- `id`: stable unique identifier
- `initCommand`: command used to initialize the project
- `installCommand`: command used to install project dependencies or plugins
- `startCommand`: command used to start the project
- `stopCommand`: command used to stop the project
- `statusCommand`: command used to check whether the project is running
- `restartCommand`: command used to restart the project
- `uninstallCommand`: command used to remove project-local runtime artifacts or unregister setup
- `openHomepageCommand`: command used to open the project homepage
- `frontendUrl`: canonical local or deployed frontend entry URL, preferred for the homepage action
- `homepageUrl`: canonical project homepage, preferred when opening the project page
- `notes`: short operator note
- `specUrl`: documentation or product spec URL for the project
- `scripts`: optional object mapping lifecycle names to relative script paths
- `scripts.init`
- `scripts.install`
- `scripts.start`
- `scripts.stop`
- `scripts.status`
- `scripts.restart`
- `scripts.uninstall`
- `scripts.openHomepage`

### 3.3 Resolution order

When both script paths and direct commands are available, the AI should prefer the project-authored script path first.

Recommended precedence:

- `scripts.start` / `startCommand`
- `scripts.init` / `initCommand`
- `scripts.install` / `installCommand`
- `scripts.stop` / `stopCommand`
- `scripts.status` / `statusCommand`
- `scripts.restart` / `restartCommand`
- `scripts.uninstall` / `uninstallCommand`
- `scripts.openHomepage` / `openHomepageCommand`

If a manifest provides `frontendUrl`, use it before trying any heuristic lookup.

### 3.4 Graphical manifest editing

`control-panel.json` is the single source of truth for a discovered project. A control surface may
provide a graphical editor that reads and atomically writes that same manifest; it must not create
a separate per-project override layer.

The editor may expose only presentation fields: `name`, `frontendUrl` (including its port), and
`notes`. It must preserve all other manifest fields unchanged. Lifecycle commands, script paths,
working directory, process ownership, and runtime fields are specification-owned and must not be
editable through the control surface. Validate a non-empty name, a complete `http` or `https`
URL, a URL port from `1` to `65535` when present, and bounded single-line text inputs.

### 3.5 Script path convention

If the manifest uses script paths, they should be relative to `workingDirectory`.

Recommended convention:

- `scripts/start.sh`
- `scripts/init.sh`
- `scripts/install.sh`
- `scripts/stop.sh`
- `scripts/status.sh`
- `scripts/restart.sh`
- `scripts/uninstall.sh`
- `scripts/open-homepage.sh`

## 4. Discovery Rules

The AI should infer the project type and lifecycle commands from the repository using these signals:

- `package.json` for Node.js projects
- `pyproject.toml`, `requirements.txt`, or `main.py` for Python projects
- `go.mod` for Go projects
- `Cargo.toml` for Rust projects
- `docker-compose.yml` or `compose.yml` for Docker Compose projects
- `Makefile` or task runners for generic automation
- Existing scripts in `scripts/`

If multiple entrypoints exist, prefer the least surprising long-running service entrypoint.
If the repository already exposes a dedicated startup script, use it rather than inventing a new startup command.

## 5. Generation Rules

### 5.1 General rules

- Generate scripts that are idempotent where possible
- Keep scripts minimal and readable
- Prefer explicit commands over opaque heuristics
- Use POSIX shell or `bash` for macOS compatibility
- Include `set -euo pipefail` unless the script has a documented reason not to
- Avoid destructive commands unless the user explicitly requested cleanup behavior
- Do not delete project files outside the control-panel script scope

### 5.2 Init script

The init script should prepare a fresh checkout for first use.

Typical init work includes:

- Creating local config files
- Bootstrapping environment variables
- Generating folders, databases, or caches the project expects
- Delegating to the project’s one-time setup command

The init script should be safe to rerun and should not start the service unless the project explicitly treats setup and start as the same action.

### 5.3 Install script

The install script should install dependencies or plugins.

Typical install work includes:

- Running the package manager install step
- Fetching language-specific dependencies
- Preparing vendored assets needed before startup

The install script should not start the service. It should be idempotent where practical and should avoid destructive cleanup.

### 5.4 Start script

The start script should:

- Launch the project in the foreground only if that is the project’s expected operator mode
- Otherwise, daemonize or background the process in a safe, documented way
- Print a clear message on success
- Fail with a nonzero exit code if startup fails

### 5.5 Stop script

The stop script should:

- Stop only the service managed by this project
- Prefer graceful shutdown first
- Fall back to a forced shutdown only if necessary
- Be safe to run multiple times
- Exit `0` when the service is already stopped unless the project explicitly requires a different behavior

### 5.6 Status script

The status script should:

- Return exit code `0` when the service is running
- Return nonzero when the service is not running
- Avoid false positives from unrelated processes
- Prefer a direct PID, socket, lock file, or service-specific check over generic `ps` matching

### 5.7 Restart script

If generated, the restart script should:

- Call stop then start
- Preserve error handling
- Exit nonzero if either step fails

### 5.8 Uninstall script

The uninstall script should remove project-local runtime artifacts or unregister project-specific setup when the project supports that flow.

Typical uninstall work includes:

- Removing generated config files
- Cleaning up local caches or temp files created by the install/init flow
- Reversing project-owned registrations

The uninstall script should be safe to run when the project is already absent or partially removed. It should fail only when the project intentionally requires manual intervention.

## 6. Heuristics by Project Type

### 6.1 Node.js

If `package.json` exists:

- Prefer `npm run dev` for development projects if it is clearly a long-running service
- Otherwise prefer `npm start`
- If neither exists, inspect scripts and infer the most likely long-running server command
- If the project uses a custom dev server or workspace runner, encode that directly in the script
- If the project already has a startup script checked into the repository, reuse it or wrap it instead of replacing it

### 6.2 Python

If Python entrypoints exist:

- Prefer a virtual environment if it is already present
- Use the project’s documented module entrypoint or server file
- Avoid assuming global Python packages

### 6.3 Go

- Prefer the documented binary entrypoint or `go run`
- Build only if the repository convention expects a build step

### 6.4 Rust

- Prefer `cargo run` for development
- Prefer a built binary only if the repository already uses that pattern

### 6.5 Docker Compose

- Prefer `docker compose up -d` for start
- Prefer `docker compose down` or a targeted stop command for stop
- Use service names only if the project structure is clear

## 7. Spec-Link Behavior

If the project has a `specUrl`, the AI should:

- Read the linked spec first
- Use the spec to choose or refine scripts
- Respect project-specific terminology and constraints from that spec
- Treat the spec as the higher-priority source over generic heuristics

When opening a project homepage, resolve in this order:

1. `frontendUrl`, `appUrl`, or `localUrl` in `control-panel.json`
2. Project-authored homepage script
3. Local frontend URL inference from the project
4. `homepageUrl` or `homepage` in `control-panel.json`
5. `homepage` or repository metadata in `package.json`
6. Git remote inference

If the spec is ambiguous:

- Ask one concise clarifying question
- Do not invent commands that could damage data or production services

## 8. Output Contract

The AI should return changes in one of these two formats.

### 8.1 Preferred format: unified diff

Return a standard unified diff that can be applied directly.

Rules:

- Include only changed files
- Keep the patch minimal
- No explanatory prose before the patch
- A short summary after the patch is allowed

### 8.2 Fallback format: file manifest JSON

If a diff is not practical, return JSON with this shape:

```json
{
  "summary": "short human summary",
  "files": [
    {
      "path": "relative/path/from/projectRoot",
      "content": "full file content"
    }
  ]
}
```

Rules:

- `path` must be relative to the project root
- `content` must be the complete file content
- Include only files that actually changed

## 9. Quality Bar

Before finalizing, the AI should verify:

- Scripts are executable on macOS
- Paths are correct and relative resolution is explicit
- `control-panel.json` is valid JSON
- Start/stop/status commands are internally consistent
- The generated files match the project type

## 10. Recommended File Layout

```text
project-root/
  control-panel.json
  scripts/
    init.sh
    install.sh
    start.sh
    stop.sh
    status.sh
    restart.sh   # optional
    uninstall.sh
    open-homepage.sh   # optional
```

## 11. Example `control-panel.json`

```json
{
  "id": "api",
  "name": "API 服务",
  "workingDirectory": ".",
  "initCommand": "./scripts/init.sh",
  "installCommand": "./scripts/install.sh",
  "startCommand": "./scripts/start.sh",
  "stopCommand": "./scripts/stop.sh",
  "statusCommand": "./scripts/status.sh",
  "uninstallCommand": "./scripts/uninstall.sh",
  "homepageUrl": "https://example.com/project",
  "notes": "本地开发服务",
  "specUrl": "https://example.com/project-spec"
}
```

## 12. Example script templates

### 12.1 `scripts/start.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Starting API service..."
npm run dev
```

### 12.2 `scripts/stop.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

pkill -f "npm run dev" || true
echo "Stopped."
```

### 12.3 `scripts/status.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

pgrep -f "npm run dev" >/dev/null
```

### 12.4 `scripts/open-homepage.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

open "https://example.com/project"
```

### 12.5 `scripts/init.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Initializing API service..."
```

### 12.6 `scripts/install.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Installing dependencies..."
npm install
```

### 12.7 `scripts/uninstall.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Removing local project artifacts..."
```

## 13. Clarification Policy

Ask a clarification question only when:

- Multiple plausible runtime entrypoints exist
- The project has destructive operations that require explicit user confirmation
- The spec link conflicts with repository evidence
- The AI cannot determine whether the project is a development server, worker, or one-shot job

Otherwise, choose the safest reasonable implementation and explain the assumption in the final summary.

## 14. Minimum acceptance checklist

A generated project should satisfy all of these:

- The project is discoverable from `control-panel.json`
- The start script actually starts the intended service
- The init and install scripts prepare the project without starting it unless explicitly intended
- The stop script can stop it cleanly
- The status script can distinguish running from not running
- The uninstall script only removes project-owned artifacts
- The manifest points to the scripts correctly
- The spec link, if present, is preserved in the manifest
- The homepage script opens the intended project page

## 15. Usage note for external AI

When you hand this file to another AI, ask it to:

- Read the linked project spec
- Inspect the project repository
- Generate or update the control scripts
- Return a patch or file manifest only
