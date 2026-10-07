# Release checklist

Source repository: [JeonNewJin/bases-kanban-companion](https://github.com/JeonNewJin/bases-kanban-companion). Community submission and approval are separate from publishing a GitHub release.

Current release candidate: **1.1.3**. Use [these release notes](release-notes-1.1.3.md) for the GitHub release description. Preparing and committing the candidate does not publish it.

## Prepared

- [x] Plugin name: Bases Kanban Companion.
- [x] Candidate ID: `bases-kanban-companion`.
- [x] Author: `wjsyuwls`; MIT license.
- [x] Empty defaults; no personal vault paths or settings in the release assets.
- [x] Configurable project/status property names, project scope, statuses, and folders.
- [x] Explicit legacy version 2 import with no automatic cross-plugin access.
- [x] English instructions, example settings, and example Base.
- [x] Local tests, browser-compatible bundle, and release asset checks.
- [x] README and 1.1.0 release notes cover card ordering, value sorting, templates, issue IDs, embedded open buttons, and optional compact layout.
- [x] Version metadata matches in package, lockfile, manifest, and compatibility map.
- [x] Document removal of the type restriction and the resulting routing scope change.
- [x] No runtime network access, Node.js APIs, telemetry, or automatic updates.

## Before publishing

- [x] Check exact name and ID conflicts in the published plugin list (2026-10-05; 8,419 entries; no exact match). Recheck at submission.
- [x] Review source, runtime imports, build dependency, and licensing attribution.
- [ ] Test desktop UI in a disposable vault: empty install, setup/import, task creation, card move to Done, reopen, conflicts, exclusions, review, and reload.
- [ ] In that vault, check template creation/IDs, value sorting, dragging with missing ranks and leading sorts, undo, and dragging with compact layout on and off.
- [ ] Capture public-safe screenshots from an example vault; add them to the README.
- [x] Restrict `isDesktopOnly` until mobile testing is complete.
- [x] Document unverified sync behavior; do not claim multi-device locking.
- [x] Use the tested 1.14.4 desktop build as `minAppVersion`. Official Kanban may still require early access on other devices.
- [x] Confirm public source repository and user approval to publish.

Desktop routing and the corrected settings layout were confirmed by the user on 1.14.4. Embedded open buttons, compact property layout, immediate toggle persistence, restoration of the native layout, and removal of type settings were checked in the existing vault. Automated tests cover these behaviors as well as empty defaults, migration, lifecycle, creation, exclusions, conflicts, and stale state. The full disposable-vault UI matrix and public-safe screenshots remain follow-up checks; they are not claimed as completed.

## Publish only after approval

1. Complete the remaining verification above, then push the reviewed source, lockfile, manifest, license, and documentation to the source repository. Do not commit local `data.json`, test vaults, `node_modules`, or personal screenshots.
2. Run `npm ci` and `npm run check`.
3. Confirm matching versions in `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` are committed.
4. Create a GitHub release tagged exactly `1.1.3` (no `v` prefix). Use the 1.1.3 release notes and attach the three assets from the same build: `release/main.js`, `release/manifest.json`, and `release/styles.css`.
5. Sign in to the [Obsidian Community directory](https://community.obsidian.md), connect the repository owner's GitHub account, and submit the plugin.
6. Address review feedback, increment versions, and publish updated assets when needed.

Submission is not approval. Follow the current [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), and [developer policies](https://docs.obsidian.md/community-directory/developer-policies). Requirements may change before submission.
