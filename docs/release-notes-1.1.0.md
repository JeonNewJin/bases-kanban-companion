# Bases Kanban Companion 1.1.0

Project issue creation, card ordering, and layout helpers for the built-in Bases Kanban view.

## Added

- **Create project issue** can copy a Markdown template, substitute plain template variables, and offer configured property values as dropdowns. Native Bases **New** is unchanged; Templater scripts are not executed.
- New plugin-created issues receive per-project identifiers such as `EXAMPLE-1`. Filenames remain the entered title. Project names use English letters and are normalized to uppercase. Existing notes are not backfilled.
- Opt-in **Experimental card ordering** saves numeric ranks through native same-column dragging. Missing ranks are initialized, columns are numbered from 1, leading native sorts constrain dragging to matching values, and the last reorder can be undone.
- **Custom value sorting** defines ordered text labels and a sort option name. Explicit Save → Apply adds a formula to the selected Base while preserving its other filters and sort options.
- External Kanban embeds show **열기 ↗** above the toolbar to open the same board in a new tab.
- Optional **Compact card layout** places property blocks side by side with labels above values and adjusts shared card height per view. It is off by default and saves/applies immediately. Turning it off restores native layout and height without saving other pending settings edits.

## Changed

- Removed **Type property** and **Required type value**. Routing and issue creation no longer require or insert `type: task`; existing note and template type values are preserved.
- Updated examples, migration guidance, and feature documentation.

## Before upgrading

Back up your vault and plugin settings. If you previously restricted routing by type, review managed folders and exclusions: any Markdown note with matching project/status in a managed folder is now eligible, regardless of its type. Existing Base filters are not changed and may still filter by type. Saving or restarting does not move notes, but subsequent eligible metadata edits can trigger routing.

Issue identifiers are allocated within one running app, not across synchronized devices. Create issues on one device and then sync; do not rely on distributed uniqueness.

## Compatibility and verification

Desktop only, minimum Obsidian **1.14.4**. Native drag integration, embedded open buttons, and compact layout use internal structures and are enabled only on the tested **1.14.4** build. Custom value sort setup is also version-guarded. Other builds retain native behavior for those features; routing and issue creation are separate.

Automated tests, bundle checks, and selected desktop UI checks have passed. The full disposable-vault UI matrix remains on the [release checklist](release-checklist.md); mobile and multi-device concurrency are not verified.

For manual installation, use `main.js`, `manifest.json`, and `styles.css` from the same release. This is an independent community plugin, not an official Obsidian product.
