# Control Panel Web Design

## Purpose

A local service workspace for one operator managing many services. The browser is the primary
surface. The Node.js backend owns discovery, configuration storage and lifecycle execution.

## Information architecture

- A persistent left sidebar provides All Services, Running, Favorites, declared collections,
  personal groups, and tags. Counts always reflect the full inventory.
- The main workspace identifies the current scope, summarizes live service counts, and shows
  searchable service rows. The launch button operates on the visible list, including filters.
- Selection spans groups and filters. A fixed bottom bar appears only after selecting services
  and provides batch launch, batch grouping and clear-selection actions.
- A service menu contains grouping, tagging, favorites, detail expansion, restart, project entry,
  folder, icon and presentation configuration actions.
- Settings contains discovery roots, declared-child guidance, scan diagnostics, login startup,
  and local configuration paths.

## Visual language

The navigation uses a deep forest background (#1c2c25); the workspace uses a soft warm white
(#f5f6f2). White service rows and subdued green metadata make state and actions easy to scan.
Primary actions use forest green (#417351); failures use muted red (#ae514a). System typography
keeps Chinese names and local paths readable. Controls have clear borders, restrained rounding,
and visible keyboard focus. No desktop window chrome, tray affordances or drag regions remain.

## Service rows

Every row shows a checkbox, project icon, name, concise note, group/role/tag badges, current
status, uptime, optional PID/port, and direct Open/Start/Stop actions. Ownership chains appear as
collection group labels and in details. Collections are organizational scopes, not stopped
runtime rows. Normal lifecycle output lives in details; errors and transitions appear inline.
Backend uptime is visible at the bottom of the sidebar to make backend restarts recognizable.

## Interaction and accessibility

- Sidebar scopes can be toggled off; quick views reset incompatible scopes.
- Searches cover names, notes, directories, group names, tags, ancestry, role and relationship notes.
- Selecting the current list affects only currently visible rows; hidden selections persist.
- Batch launch results distinguish executed commands, skipped services and failures.
- Dialogs have names, form labels, Escape dismissal, keyboard focus trapping and focus restoration.
- Periodic status refresh preserves open service menus and expanded details.
- At narrow widths the sidebar becomes a toggleable navigation panel; service actions and
  runtime information reflow below the identity. No essential functionality depends on hover.

## Validation

Browser checks cover the sidebar and list at desktop width, navigation and settings at a narrow
width, and grouping/tagging/favorites persistence and workspace launch with isolated fixtures.
Backend integration tests exercise declared-child discovery, boundary enforcement, local
preferences, partial startup failures and the local HTTP access boundary.
