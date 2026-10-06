# Bases Kanban Companion 1.1.1

Fixes a freeze when clicking in a note that embeds a Kanban board.

## Fixed

- Clicking in the body of a note with an embedded Kanban board could freeze Obsidian. The embedded open button and compact card layout re-rendered immediately whenever the note's DOM changed, so a change undone by the editor or the native renderer could repeat without ever yielding.
- Both features now re-render on the next animation frame, ignore DOM changes and `css-change` events caused by their own updates, and pause after 20 consecutive refreshes that keep changing the DOM. They resume on the next workspace change (opening a file, switching tabs or changing the layout), and a console warning names the paused feature.

## Compatibility and verification

Desktop only, minimum Obsidian **1.14.4**. No settings or data changes; upgrading from 1.1.0 only requires replacing the release assets.

Automated tests and bundle checks have passed, including new tests for frame scheduling, ignored self-updates and the refresh limit.

For manual installation, use `main.js`, `manifest.json`, and `styles.css` from the same release. This is an independent community plugin, not an official Obsidian product.
