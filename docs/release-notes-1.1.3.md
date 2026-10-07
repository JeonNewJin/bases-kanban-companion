# Bases Kanban Companion 1.1.3

Adjustable property block width for the compact card layout.

## Added

- **Settings → Card layout → Property block width** sets the minimum width of each property block in compact cards, from 3 to 10rem in 0.5rem steps. The default stays at 5rem. Like the layout toggle, it saves and applies immediately without saving other pending edits.
- Lower it when blocks wrap onto an extra row in narrow columns, for example when a column's scrollbar takes up width.

Card height is unchanged: each card still fits one label row and one value row, so the official Kanban view can keep positioning cards with a shared height.

## Compatibility and verification

Desktop only, minimum Obsidian **1.14.4**. Existing settings keep the 5rem default; no other changes are required. The compact layout remains enabled only on the tested **1.14.4** build.

Automated tests and bundle checks have passed, including new tests for width validation, immediate saving and re-measurement.

For manual installation, use `main.js`, `manifest.json`, and `styles.css` from the same release. This is an independent community plugin, not an official Obsidian product.
