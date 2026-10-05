# Bases Kanban Companion 1.0.0

Initial desktop release for Obsidian 1.14.4 or newer.

## Features

- Map project statuses to folders while keeping the built-in Bases Kanban columns.
- Configure property names, required type value, excluded folders, and project rules.
- Create project tasks with metadata and an initial status.
- Review pending moves before reconciling existing notes.
- Import version 2 Project Task Router settings explicitly.
- Responsive settings controls with labels above the inputs.

Fresh installations have no rules. Conflicting destination files are skipped rather than overwritten. No accounts, network requests, or telemetry are used at runtime.

## Installation

Download all three assets: `main.js`, `manifest.json`, and `styles.css`. Place them in `.obsidian/plugins/bases-kanban-companion/`, reload Obsidian, and enable the plugin.

See the repository README for configuration and migration instructions. Back up your vault before enabling automation.

## Compatibility and verification

- Desktop only; mobile and multi-device concurrent editing are not yet verified.
- Desktop routing and settings layout confirmed on Obsidian 1.14.4.
- Unit and integration tests plus build and release-asset checks pass.
- Uses the official Bases Kanban view but is an independent plugin.
- GitHub publication does not mean approval or availability in the Obsidian community directory.
