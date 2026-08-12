# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a macOS developer maintaining several local development projects who needs to see and operate them without remembering each project's lifecycle commands. The project is also published for other interested developers with the same local workflow.

## Product Purpose

Control Panel is a local macOS menu-bar control center for discovering development projects, checking their service state, and starting, stopping, restarting, or opening them from one place. It reduces the mental overhead of managing scattered local services while leaving every project in control of its own code and lifecycle commands.

## Positioning

Rather than becoming another process manager or repository host, Control Panel discovers a small, project-owned `control-panel.json` contract and uses it to provide a shared, inspectable standard for local project integration. Projects retain their own scripts or external supervisor; the panel supplies the common discovery and control surface.

## Operating Context

Used locally on macOS while developing and maintaining multiple web apps, desktop apps, and local services. Users add scan roots; the application checks each root and its direct children for `control-panel.json`, then invokes the declared lifecycle commands from the declared working directory.

## Capabilities and Constraints

- Automatically discovers projects from configured scan roots.
- Shows project runtime status and provides start, stop, restart, and primary-entry actions.
- Lets users customize project display name, URL or port, and notes through the app; lifecycle fields remain project-owned.
- Uses `control-panel.json` plus project scripts or an external supervisor as the integration contract.
- Supports web projects, desktop applications, hybrid projects, and services, including Electron development mode.
- Distinguishes `managed`, `external`, and `observed` process modes instead of assuming every project is directly managed.
- Runs locally and targets macOS only.
- Does not take ownership of project repositories or upload project data.
- Must remain quick to use and customizable.

## Brand Commitments

Name: Control Panel. Voice and behavior should be practical, clear, and low-friction for local development work.

## Evidence on Hand

- Product overview and integration contract: `README.md`.
- Electron implementation: `src/`.
- Existing tray and application icons: `assets/`.
- Example state configuration: `config/projects.example.json`.

## Product Principles

1. Discover projects automatically instead of making users maintain duplicate lists.
2. Standardize integration through a small, project-owned lifecycle contract.
3. Keep control flexible while making common operations immediate.
4. Reduce cognitive load without concealing service state or process responsibility.
5. Keep local projects and data local.
