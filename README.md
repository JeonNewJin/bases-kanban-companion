# Bases Kanban Companion

Route project notes to status-based folders alongside Obsidian's built-in Bases Kanban view. Keep **To do**, **Doing**, and **Review** in one folder, and move **Done** to an archive folder without changing your board layout.

An independent community plugin, not an official Obsidian product. It does not add a Kanban view or replace Bases.

## Features

- Map each project's statuses to folders. Multiple statuses can share a folder.
- Configure project and status property names.
- Exclude folders, including their descendants.
- Create tasks with project metadata and an initial status in a configured folder.
- Create issues from Markdown templates and allocate per-project identifiers.
- Reorder cards with a numeric property, respecting leading native sort options.
- Define custom text-value sorting, including labels in your own language.
- Open embedded Kanban boards in a new tab.
- Optionally display compact cards with horizontal property blocks.
- Review pending moves before applying rules to existing notes.
- Import settings from Project Task Router version 2 without rewriting note properties.

All processing is local. No accounts, network requests, telemetry, or extra runtime dependencies.

## Requirements and installation

Supports **desktop Obsidian 1.14.4 or newer**. Card dragging, custom value sort setup, compact layout, and embedded open buttons are enabled only on the tested **1.14.4** build; routing and issue creation are separate. Mobile is not enabled until it has been tested. Enable the **Bases** core plugin to use the official Kanban view. Routing also works when you edit a note's status directly.

To install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/JeonNewJin/bases-kanban-companion/releases/latest), or build from source with the commands below.
2. Back up your vault and test in a disposable vault first.
3. Create `.obsidian/plugins/bases-kanban-companion/` in that vault.
4. Copy the three downloaded files (or the built files from `release/`) into it.
5. Reload Obsidian and enable **Bases Kanban Companion** in Community plugins.

No rules are installed by default, and no startup scan moves existing notes.

## Quick start

Open **Settings → Bases Kanban Companion**.

1. Keep the default properties: `project` and `status`.
2. Add a project named `EXAMPLE` and set its new-task folder to `Tasks/Active`.
3. Add the following statuses, in this order:

| Status | Folder |
| --- | --- |
| To do | Tasks/Active |
| Doing | Tasks/Active |
| Review | Tasks/Active |
| Done | Tasks/Archive |

4. Save. Saving settings does not move existing notes.
5. Run **Bases Kanban Companion: Create project issue** from the command palette.
6. Open [the example Base](examples/Example%20board.base), which groups cards by `status` and includes both folders.
7. Move the card to **Done**. Its `status` changes, and the plugin moves the same note to `Tasks/Archive`. Move it back to **Doing** to restore it to `Tasks/Active`.

You can also import [example-settings.json](examples/example-settings.json) in the settings screen, review the draft, and save.

A task contains properties like these:

```yaml
---
project: EXAMPLE
status: To do
issue_id: EXAMPLE-1
---
```

The new-task command fills those properties automatically. The first configured status is the initial status. Native Bases **New** buttons are separate: this plugin does not intercept them or control their creation folder. Add matching properties to notes created that way.

## Routing scope and safety

- Only Markdown notes are eligible. `.base` files and attachments are not moved.
- Project and status values must match exactly. Note `type` values do not restrict routing.
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

### Upgrading to 1.1.0

The **Type property** and **Required type value** settings have been removed.
Routing now uses project, status, and managed folders, regardless of a note's `type`.
Review managed folders and exclusions before upgrading if you used that restriction.
Existing note properties and Base filters are not rewritten; a `type` filter in
your Base still applies. Compact layout is off by default; an existing saved
compact-layout preference is retained. See [the 1.1.0 release notes](docs/release-notes-1.1.0.md).

## Kanban features

### Open an embedded Kanban board

On desktop Obsidian **1.14.4**, external `.base` Kanban embeds in Markdown notes
show **Open** on the left above the native toolbar, away from Live Preview's
top-right code-edit action. Click to open the same Base in a
new tab; an explicit view fragment in the embed link is retained. Works in Live
Preview and reading mode. Standalone Bases, other layouts, and inline `base` code
blocks do not receive the button. There is no project-specific path or setting.

This feature observes the existing embed DOM, rather than
replacing the official Kanban view or adding another layout. Other app versions
are disabled until their DOM has been verified. Link resolution and opening use
public Obsidian APIs, including source-note context for relative links and nested
note embeds. Buttons and observers are removed on unload or when leaves/views
change. Buttons are hidden in print. No notes, Base configuration, sort options,
or plugin settings are written by this feature.

### Compact card layout

When enabled, Kanban card titles remain above a responsive row of property blocks. Each block
keeps its label above its value; additional blocks wrap when the card is narrow.
**Settings → Card layout → Compact card layout** is optional and off by
default, including when importing older settings. Toggling it saves and applies
immediately, without **Save** or a plugin reload. Other settings remain drafts
until Save; this toggle does not save their pending edits. One toggle controls both horizontal property
blocks and compact height. Turning it off restores the official vertical property
layout and card height immediately; notes and sorting remain unchanged.

When enabled on desktop Obsidian **1.14.4**, the plugin measures the rendered property rows and
adjusts the official view's sizing placeholders to their total height. Cards share
one compact height per view; resizing or changing displayed properties recalculates
it. The native renderer still calculates card positions, scroll height and drag
targets. Titles stay single-line and cover-image height remains native. No note,
sort or Base configuration is written. Other Base layouts and note Properties are
unchanged. This uses version-guarded internal DOM, not a public variable-height API.
Observers and all layout/sizing overrides are removed when disabled or on unload.
Other versions retain the official layout until their DOM has been verified.

### Create issues from templates

**Create project issue** offers **Choose template** and **Clear**.
Set an optional **Template folder** in plugin settings; its Markdown files and
subfolders are searchable by full path. Blank searches all visible Markdown notes.
Without a selection, creation keeps the built-in task layout. Native Bases **New**
is not intercepted.

The new note copies the template's properties and body. The selected project,
first configured status, and explicitly selected dropdown
values override template properties. Leave a dropdown at **Use template value /
not set** to keep its template value. Other properties, including `type`, remain
unchanged. The source template is never edited.
Frontmatter is reserialized, so YAML comments and formatting may change.

Plain templates support `{{title}}`, `{{date}}`, `{{time}}`, and Moment formats
such as `{{date:YYYY/MM/DD}}` in body text and string property values. Defaults
are `YYYY-MM-DD` and `HH:mm`, independent of the core Templates settings.
Unknown variables remain literal. Templater scripts (`<% … %>`) are rejected,
not executed. Invalid frontmatter, stale templates, settings changes, and existing
target files abort creation. The Templates core plugin is not required.

### Project issue identifiers

New issues created through **Create project issue** receive `issue_id: PROJECT-1`,
then `PROJECT-2`, independently per project. Filenames remain the entered title.
The generated ID overrides any template ID. Existing cards are not backfilled;
native Bases **New** does not allocate an ID.

Project names saved through settings must contain English letters only and are
normalized to uppercase (`example` → `EXAMPLE`). Digits, spaces and punctuation are
rejected. Legacy names are preserved on load, not silently renamed. They cannot
create new identifiers until corrected. Case-normalization saves are blocked
while existing notes still use the previous name; update those project values
first. Routing retains its exact-match behavior. `issue_id` is reserved and cannot
be used as a routing, ordering or custom-value property.

Last reserved numbers are stored in plugin `data.json` as `issueCounters`, separate
from card order. Creation and settings writes run in one queue. A reservation is
persisted before the note is created; failure can leave a gap. Deleting a note or
project, restarting, and saving/importing an older settings draft do not lower the
stored counters. A fresh scan of all visible Markdown notes also considers
existing IDs, including archived notes and templates; omit IDs from templates
to avoid reserving unnecessary numbers. Moving notes does not change their IDs.

This is a **single-app allocator**, not a distributed sequence service. Simultaneous
creation on synchronized devices is not guaranteed unique. Create issues on one
device, then sync. Keep backups of `data.json`: losing counters and deleting the
corresponding notes removes the history needed to prevent reuse. Do not manually
edit counters or identifiers. No startup scan changes existing notes.

### Manual card ordering (experimental)

Enable the opt-in **Experimental card ordering** setting to reorder cards.
It keeps the official Kanban view and
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

Card ordering supports up to 200 cards per column without a search or result
limit. Arbitrary formulas, file modification time, and file size before `order`
are not supported because their values may change when order is saved. Only the
unchanged generated formulas described below are accepted. Multi-file writes
are not atomic: completed writes are restored on failure where no later edit
conflicts; any incomplete recovery is reported. Back up before testing.

### Custom text-value ordering

Configure **Custom value sorting** for existing text properties,
such as `priority`. Enter one label per line in display order, e.g. `High`, `Medium`,
`Low`. Set **Sort option name** to the label you want in the official Sort menu,
e.g. `Priority: High → Medium → Low`. This names the generated sort, not the actual
note property. An empty name keeps the current board label or generates a default.
The automatic guidance under each rule tells you to select that name in the
official Kanban **Sort** menu and put `order` with ascending direction below it.
It also shows the configured value order and explains same-value dragging. There
is no editable Description field; help is generated in settings and the Apply
confirmation, not stored as a user-written description or task property.

Labels remain ordinary note properties, not a global enum; existing notes
are never assigned or renamed automatically. The plugin’s **Create project issue**
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

## Development

Node.js 22 or newer is recommended for development. Node.js is not required by the plugin at runtime.

```sh
npm ci
npm run check
```

This runs unit and integration tests, bundles `src/main.cjs` into `main.js`, and prepares `release/` with only the three installable assets. Tests and build scripts use Node.js; the runtime bundle imports only `obsidian`. Card ordering also reads internal drag structures as described above.

- `src/core.cjs`: configuration, migration, note matching, and task metadata.
- `src/router.cjs`: serialized moves, conflicts, and stale-state checks.
- `src/card-order.cjs`: rank updates, leading-sort constraints, recovery, and the version-guarded native drag adapter.
- `src/value-sort.cjs`: explicit Base setup and safe custom label-to-rank formulas.
- `src/task-template.cjs`: template filtering, property merging, and plain variable rendering.
- `src/issue-id.cjs`: per-project issue numbers and monotonic counter merging.
- `src/kanban-tracker.cjs`: version-guarded discovery of official Kanban views, shared by the open buttons and compact layout.
- `src/render-scheduler.cjs`: frame-deferred refreshes with a limit on repeated DOM changes.
- `src/embedded-board.cjs`: open buttons for official Kanban embeds.
- `src/card-layout.cjs`: compact shared card sizing using native Kanban measurements.
- `src/main.cjs`: Obsidian lifecycle, commands, and settings UI.
- `test/`: routing, settings, and plugin-lifecycle tests.

For release preparation and remaining verification, see [the release checklist](docs/release-checklist.md).

## License

[MIT](LICENSE). Copyright © 2026 wjsyuwls.
