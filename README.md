# Bases Kanban Companion

Route project notes to status-based folders alongside Obsidian's built-in Bases Kanban view. Keep **To do**, **Doing**, and **Review** in one folder, and move **Done** to an archive folder without changing your board layout.

An independent community plugin, not an official Obsidian product. It does not add a Kanban view or replace Bases.

## Features

- Map each project's statuses to folders. Multiple statuses can share a folder.
- Configure project, type, and status property names and the required type value.
- Exclude folders, including their descendants.
- Create tasks with project metadata and an initial status in a configured folder.
- Review pending moves before applying rules to existing notes.
- Import settings from Project Task Router version 2 without rewriting note properties.

All processing is local. No accounts, network requests, telemetry, or extra runtime dependencies.

## Requirements and installation

The initial release supports **desktop Obsidian 1.14.4 or newer**. Mobile is not enabled until it has been tested. Enable the **Bases** core plugin to use the official Kanban view. Routing also works when you edit a note's status directly. Obsidian 1.14 may require early access on your device.

This plugin has **not been approved by the community directory**. Install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/JeonNewJin/bases-kanban-companion/releases/latest), or build from source with the commands below.
2. Back up your vault and test in a disposable vault first.
3. Create `.obsidian/plugins/bases-kanban-companion/` in that vault.
4. Copy the three downloaded files (or the built files from `release/`) into it.
5. Reload Obsidian and enable **Bases Kanban Companion** in Community plugins.

No rules are installed by default, and no startup scan moves existing notes.

## Quick start

Open **Settings → Bases Kanban Companion**.

1. Keep the default properties: `project`, `type`, and `status`; required type: `task`.
2. Add a project named `Example` and set its new-task folder to `Tasks/Active`.
3. Add the following statuses, in this order:

| Status | Folder |
| --- | --- |
| To do | Tasks/Active |
| Doing | Tasks/Active |
| Review | Tasks/Active |
| Done | Tasks/Archive |

4. Save. Saving settings does not move existing notes.
5. Run **Bases Kanban Companion: Create project task** from the command palette.
6. Open [the example Base](examples/Example%20board.base), which groups cards by `status` and includes both folders.
7. Move the card to **Done**. Its `status` changes, and the plugin moves the same note to `Tasks/Archive`. Move it back to **Doing** to restore it to `Tasks/Active`.

You can also import [example-settings.json](examples/example-settings.json) in the settings screen, review the draft, and save.

A task contains properties like these:

```yaml
---
project: Example
type: task
status: To do
---
```

The new-task command fills those properties automatically. The first configured status is the initial status. Native Bases **New** buttons are separate: this plugin does not intercept them or control their creation folder. Add matching properties to notes created that way.

## Routing scope and safety

- Only Markdown notes are eligible. `.base` files and attachments are not moved.
- Project and status values must match exactly. If a required type is set, that value must also match exactly.
- The note's current folder must be the project's new-task folder or one of its destination folders. Managed subfolders are not implicitly included.
- Excluded folders and their descendants cannot be sources or destinations. Add your template folder here if it overlaps a managed folder.
- Paths must be vault-relative and non-hidden. Root, absolute, traversal, and hidden-folder paths are rejected.
- Existing destination files are never intentionally overwritten; conflicts are skipped with a notice. Obsidian or the filesystem may also reject a rename, for example due to case-insensitive filename collisions.
- Moves use Obsidian's FileManager, respecting its link-update setting.
- Unknown statuses and disabled or unconfigured projects are ignored.
- Startup does not reconcile existing notes. After startup, matching metadata edits or file renames trigger routing, even if the edit did not change the status itself.
- Existing notes can be moved through **Review pending moves**, which lists source and destination paths before applying.

This is not a backup or a move-history system. To undo a routed move, change the status to one mapped to the previous folder, or move the note manually. Back up your vault before enabling automation.

## Board filters

Include every relevant folder in your Base filter, including archive destinations. Otherwise, moved cards disappear from that view even though the notes still exist. The plugin never edits your `.base` files automatically.

If you only need columns for physical folders, Bases itself supports moving cards between `file.folder` columns. This plugin is useful when **status columns and physical folders differ**. See [the official folder-column announcement](https://obsidian.md/changelog/2026-09-15-desktop-v1.14.2/) and [Bases Kanban help](https://obsidian.md/help/bases/views/kanban).

## Migrating from Project Task Router

See [migration instructions](docs/migration.md). Keep a copy of your old settings and disable the old plugin before enabling equivalent rules here. Do not run both routers on the same notes.

## Development

Node.js 22 or newer is recommended for development. Node.js is not required by the plugin at runtime.

```sh
npm ci
npm run check
```

This runs unit and integration tests, bundles `src/main.cjs` into `main.js`, and prepares `release/` with only the three installable assets. Tests and build scripts use Node.js; the runtime bundle only imports the public `obsidian` API.

- `src/core.cjs`: configuration, migration, note matching, and task metadata.
- `src/router.cjs`: serialized moves, conflicts, and stale-state checks.
- `src/main.cjs`: Obsidian lifecycle, commands, and settings UI.
- `test/`: routing, settings, and plugin-lifecycle tests.

For release preparation and remaining verification, see [the release checklist](docs/release-checklist.md).

## License

[MIT](LICENSE). Copyright © 2026 wjsyuwls.
