---
name: Control Panel
description: A dense, local macOS operations console for project health and direct control.
colors:
  canvas: "#0f1212"
  chrome: "#131717"
  surface: "#171b1b"
  surface-raised: "#1c2121"
  surface-hover: "#202626"
  text: "#f1f3ef"
  muted: "#a2aaa5"
  quiet: "#7d8782"
  line: "#29302f"
  line-strong: "#3a4441"
  mint: "#78d6a4"
  mint-dim: "#284b39"
  amber: "#e6b45b"
  coral: "#e77b6f"
  coral-dim: "#4a2926"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Noto Sans SC, sans-serif"
  summary-count:
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  project-name:
    fontSize: "13px"
    fontWeight: 690
    letterSpacing: "-0.01em"
  control:
    fontSize: "12px"
    fontWeight: 680
    lineHeight: 1
  label:
    fontSize: "9px"
    fontWeight: 700
    letterSpacing: "0.06em"
rounded:
  menu: "6px"
  control: "7px"
  group: "9px"
  panel: "11px"
spacing:
  tight: "7px"
  control: "11px"
  group-header: "13px"
  page: "18px"
  modal: "21px"
components:
  button-primary:
    backgroundColor: "{colors.mint}"
    textColor: "#102319"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
    height: "30px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "#d8ded9"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
    height: "30px"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
    height: "34px"
    width: "310px"
  project-group:
    backgroundColor: "#121616"
    rounded: "{rounded.group}"
  project-menu:
    backgroundColor: "#202525"
    rounded: "{rounded.group}"
    padding: "6px"
---

# Design System: Control Panel

## Overview

**Creative North Star: "The Quiet Machine Room"**

Control Panel is a dense macOS local-operations console: calm, dark, and factual. Graphite surfaces, warm-white text, hairline boundaries, and compact native controls make live project state legible without turning project management into a dashboard spectacle.

The interface leads with operations. The title bar, four-part status summary, filtering toolbar, and grouped project rows form a short scan path from machine health to the one service that needs attention. Individual project icons remain monochrome; mint, amber, and coral appear only to communicate state or a direct operation.

**Key Characteristics:**

- Dense grouped rows, not equal-weight dashboard cards.
- Tonal graphite layers and precise one-pixel hairlines.
- Warm, system-native typography with compact labels and direct controls.
- Sparse semantic color and understated state motion.

## Colors

The palette is almost entirely graphite and warm white; semantic color is reserved for health, action, and attention.

### Primary

- **Operational Mint:** Used for the default action, healthy indicators, running state, and focused controls.

### Secondary

- **Attention Amber:** Used for starting and stopping states, including the status rail and transient output.

### Tertiary

- **Fault Coral:** Used for error state text, rails, and stop operations.

### Neutral

- **Machine Canvas:** The application background behind all chrome and surfaces.
- **Graphite Chrome:** The title bar, summary, and empty-state base layer.
- **Working Surface:** The standard field and settings-panel layer, with raised and hover variants for interactive containment.
- **Warm White and Quiet Grey:** Warm white carries active text; muted and quiet grey carry supporting values, labels, and timestamps.
- **Hairlines:** Standard and stronger graphite lines divide groups, rows, fields, menus, and modal panels.

### Named Rules

**The Signal-Only Accent Rule.** Mint, amber, and coral communicate a real operation or runtime condition. Do not use them as decoration or to color project identities.

## Typography

**Body Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Noto Sans SC", sans-serif`

**Character:** Native macOS text is compact and quietly weighted. Information hierarchy comes from small, deliberate size and weight changes rather than large display type.

### Hierarchy

- **Summary count:** The largest live metric; used in the system summary.
- **Project name:** The primary row identifier; slightly tightened and semibold.
- **Control:** Used by standard buttons, search, and select controls.
- **Status and supporting text:** Compact values and notes support scanning without competing with project names.
- **Label:** Uppercase metadata labels use a small, bold, tracked treatment.

### Named Rules

**The Compact Evidence Rule.** Keep operational text concise, single-line where the implementation clips it, and subordinate supporting facts to project identity and state.

## Layout

The content shell sits below a compact title bar and uses a centered fluid container with a maximum width of 1460px. Desktop begins with a five-part summary: a broad lead metric and four health metrics. Project groups stack with a small inter-group gap; their rows use a five-column grid for icon, identity, status rail, runtime facts, and direct controls.

At 1050px, the summary becomes a lead plus two-by-two metrics and runtime PID/port fields disappear. At 760px, the summary becomes two columns, the toolbar wraps, the title bar hides secondary identity elements, and each project row becomes icon, identity, and controls with runtime information below. The status rail is intentionally removed on this compact layout.

## Elevation & Depth

Depth is primarily tonal and structural: darker canvas, chrome, surface, raised surface, and hover surface are separated with hairlines. Shadows are reserved for floating menus and modal cards; they do not lift ordinary rows or panels. Interactive state changes use short background, border, color, and transform transitions, and reduced-motion preferences reduce those durations to 1ms.

### Shadow Vocabulary

- **Floating Overlay:** Used by the project overflow menu and modal card to separate a temporary layer from the machine surface.
- **Healthy Indicator Glow:** A small mint glow accompanies the healthy dot and running rail marker only.

### Named Rules

**The Flat-at-Rest Rule.** Rows, fields, groups, and settings panels stay flat. Use elevation only when an element floats over the current task.

## Shapes

The form language is gently rounded and controlled: controls use the compact control radius, menus and groups use a slightly larger radius, and summary or modal panels use the broadest radius. Borders are one pixel and graphite. Project icons are contained in small rounded-square buttons; status uses circles, a one-pixel rail, and monochrome line-drawn metric glyphs.

## Components

### Buttons

- **Character:** Compact, direct, and stateful.
- **Shape:** Softly rounded controls using the control radius.
- **Primary:** Mint background with dark text; standard controls are at least 30px tall, while row actions are denser.
- **Hover / Focus:** Primary mint brightens on hover and shifts down one pixel on active. Keyboard focus uses a 2px mint outline offset by 2px.
- **Secondary / Ghost:** Secondary controls use a raised graphite fill and stronger hairline. Window actions are text-like and transparent; overflow-menu actions remain transparent until hover.
- **Runtime action:** Start uses a restrained green-toned treatment; stop changes to coral-toned border, text, and fill.

### Inputs / Fields

- **Style:** Search, select, text input, and textarea use the working surface, stronger hairline, and control radius.
- **Focus:** The shared mint focus outline is used for all keyboard-focusable fields.
- **Disabled:** Disabled buttons retain their form but reduce opacity and show a not-allowed cursor.

### Cards / Containers

- **Character:** Project groups are dense operational lists, not individual feature cards.
- **Corner Style:** Groups use the group radius; summary and modal panels use the panel radius.
- **Background:** Group rows sit on a dark graphite base and take a subtle state tint when running or in error.
- **Border:** Groups, summary, panels, fields, and row dividers use hairlines.
- **Internal Padding:** Rows and headers use compact padding; modals use the modal spacing token.

### Navigation

- **Style:** The top window bar is a compact native-style command strip with a draggable left region and right-aligned text actions.
- **Responsive behavior:** The mark, divider, subtitle, and quiet configuration-file action hide on small screens while the Control Panel name remains.

### Status Rail

- **Style:** Desktop project rows include a thin horizontal rail with a small state marker. Running uses mint and a minimal glow; starting and stopping use amber; error uses coral; inactive uses quiet grey.
- **Responsive behavior:** Hide the rail on small screens; preserve the written status in the runtime area.

## Do's and Don'ts

### Do:

- **Do** keep the first scan path compact: title bar, truthful summary, toolbar, grouped rows, then direct actions.
- **Do** use warm white for active text and quiet grey for supporting metadata.
- **Do** use mint for healthy or default operational intent, amber for transition, and coral for fault or stop intent.
- **Do** keep project symbols monochrome and contained in the existing rounded-square icon treatment.
- **Do** use one-pixel graphite hairlines and tonal surface changes to group information.

### Don't:

- **Don't** turn project rows into generic dashboard cards or give all information equal visual weight.
- **Don't** use mint, amber, or coral as decorative branding or project-category color.
- **Don't** add permanent shadows to ordinary rows, groups, or fields.
- **Don't** replace direct start, stop, and open actions with hidden management flows.
