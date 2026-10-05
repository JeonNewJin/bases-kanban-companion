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

### Local prototype: manual card ordering

The working source contains an opt-in **Experimental card ordering** prototype,
not included in the published 1.0.0 release. It keeps the official Kanban view and
uses guarded, undocumented drag information from desktop Obsidian **1.14.4**.
Other versions are disabled for this feature; normal folder routing is separate.

Enable it in settings, and include the configured numeric property (`order` by
default) with **ascending** direction in the official **Sort** menu. Manage sort options and their precedence
there; dragging does not rewrite your sort list or add a separate priority mode.

- `order` first: reorder freely within a status column, regardless of priority.
- `priority` then `order`: reorder only cards with the same priority.
- `priority`, `assignee`, then `order`: both values must match.
- Sort options after `order` do not restrict dragging.
- No `order` in Sort: custom card reordering is inactive.

Only `order` values change. Each same-column drop numbers the entire
displayed column from **1 at the top** to N at the bottom, initializing missing
ranks and closing gaps. Numbers do not restart per priority. Cards outside the
moved bucket stay in their displayed positions, but their numbers may change.
Switching to `order`-only sorting follows this last saved display order, not an
older manual order hidden by priority sorting. Descending `order` is rejected with
an instruction to choose ascending; the plugin does not change your Sort menu.
Same-position drops also fix missing or non-sequential ranks, including a
single-card column. An already-numbered same-position drop writes nothing.
Startup, sort changes and cross-column moves do not renumber notes.
**Undo last card reorder** restores the last update in the current plugin session,
provided those fields have not changed since then.

The prototype supports up to 200 cards per column without a search or result
limit. Arbitrary formulas, file modification time, and file size before `order`
are not supported because their values may change when order is saved. Only the
unchanged generated formulas described below are accepted. Multi-file writes
are not atomic: completed writes are restored on failure where no later edit
conflicts; any incomplete recovery is reported. Back up before testing.

### Local prototype: custom text-value ordering

Also unpublished: configure **Custom value sorting** for existing text properties,
such as `priority`. Enter one label per line in display order, e.g. `높음`, `보통`,
`낮음`. Set **Sort option name** to the label you want in the official Sort menu,
e.g. `우선순위: 높음 → 보통 → 낮음`. This names the generated sort, not the actual
note property. An empty name keeps the current board label or generates a default.
The automatic guidance under each rule tells you to select that name in the
official Kanban **Sort** menu and put `order` with ascending direction below it.
It also shows the configured value order and explains same-value dragging. There
is no editable Description field; help is generated in settings and the Apply
confirmation, not stored as a user-written description or task property.

Labels remain ordinary note properties, not a global enum; existing notes
are never assigned or renamed automatically. The plugin’s **Create project task**
dialog offers those labels as optional dropdown choices. Native Bases **New** and
Obsidian’s property editor are not replaced or restricted.

1. Save the rule in settings.
2. In the official Kanban Sort menu, include that text property and `order`.
3. Click **Apply saved rules to a Base**, or run **Apply custom value sorting to
   Base**, choose a `.base` file and confirm.
4. The selected Base gets a numeric formula sort before the matching text sort.
   With ascending formula sort, labels follow the configured order; unlisted and
   empty values sort last. The text sort keeps unlisted labels separate.
5. Same-column dragging changes only `order` within identical leading values.
   Further sorts before `order` (e.g. assignee) still constrain dragging.

Change label order by editing the settings list, saving, and reapplying to the
Base. The same Save → Apply flow updates the option name without
changing the generated formula or sort positions. A removed secondary text sort
is not restored on reapplication. Keep it if you need unlisted labels separated;
using only the generated formula and `order` is sufficient for the listed values.
A stale or manually edited formula blocks constrained dragging rather than
guessing its meaning. Reapplication preserves native sort precedence/directions,
other views and filters, and refuses to overwrite an edited formula. The explicit
setup rewrites that selected Base’s YAML, so comments/formatting may change. No
startup scan edits Bases or task notes. Generated formulas remain usable by Bases
when the companion is disabled. Remove their sort rows in the official menu to
return to ordinary text sorting; removing a settings rule alone does not remove
an already-applied Base sort.

Node.js 22 or newer is recommended for development. Node.js is not required by the plugin at runtime.

```sh
npm ci
npm run check
```

This runs unit and integration tests, bundles `src/main.cjs` into `main.js`, and prepares `release/` with only the three installable assets. Tests and build scripts use Node.js; the runtime bundle imports only `obsidian`. The card-order prototype also reads internal drag structures as described above.

- `src/core.cjs`: configuration, migration, note matching, and task metadata.
- `src/router.cjs`: serialized moves, conflicts, and stale-state checks.
- `src/card-order.cjs`: rank updates, leading-sort constraints, recovery, and the version-guarded native drag adapter.
- `src/value-sort.cjs`: explicit Base setup and safe custom label-to-rank formulas.
- `src/main.cjs`: Obsidian lifecycle, commands, and settings UI.
- `test/`: routing, settings, and plugin-lifecycle tests.

For release preparation and remaining verification, see [the release checklist](docs/release-checklist.md).

## License

[MIT](LICENSE). Copyright © 2026 wjsyuwls.
