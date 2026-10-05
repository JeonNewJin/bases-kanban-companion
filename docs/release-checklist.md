# Release checklist

Source repository: [JeonNewJin/bases-kanban-companion](https://github.com/JeonNewJin/bases-kanban-companion). The user approved publication. Community submission and approval are separate from publishing a GitHub release.

## Prepared

- [x] Plugin name: Bases Kanban Companion.
- [x] Candidate ID: `bases-kanban-companion`.
- [x] Author: `wjsyuwls`; MIT license.
- [x] Empty defaults; no personal vault paths or settings in the release assets.
- [x] Configurable property names, type value, project scope, statuses, and folders.
- [x] Explicit legacy version 2 import with no automatic cross-plugin access.
- [x] English instructions, example settings, and example Base.
- [x] Local tests, browser-compatible bundle, and release asset checks.
- [x] No runtime network access, Node.js APIs, telemetry, or automatic updates.

## Before publishing

- [x] Check exact name and ID conflicts in the published plugin list (2026-10-05; 8,419 entries; no exact match). Recheck at submission.
- [x] Review source, runtime imports, build dependency, and licensing attribution.
- [ ] Test desktop UI in a disposable vault: empty install, setup/import, task creation, card move to Done, reopen, conflicts, exclusions, review, and reload.
- [ ] Capture public-safe screenshots from an example vault; add them to the README.
- [x] Restrict `isDesktopOnly` until mobile testing is complete.
- [x] Document unverified sync behavior; do not claim multi-device locking.
- [x] Use the tested 1.14.4 desktop build as `minAppVersion`. Official Kanban may still require early access on other devices.
- [x] Confirm public source repository and user approval to publish.

Desktop routing and the corrected settings layout were confirmed by the user on 1.14.4. Automated tests cover empty defaults, migration, lifecycle, creation, exclusions, conflicts, and stale state. The full disposable-vault UI matrix and public-safe screenshots remain follow-up checks; they are not claimed as completed.

## Publish only after approval

1. Create a GitHub source repository and push the reviewed source, lockfile, manifest, license, and documentation. Do not commit local `data.json`, test vaults, `node_modules`, or personal screenshots.
2. Run `npm ci` and `npm run check`.
3. Commit matching versions in `package.json`, `manifest.json`, and `versions.json`.
4. Create a GitHub release tagged exactly `1.0.0` for the initial release. Attach `release/main.js`, `release/manifest.json`, and `release/styles.css`.
5. Sign in to the [Obsidian Community directory](https://community.obsidian.md), connect the repository owner's GitHub account, and submit the plugin.
6. Address review feedback, increment versions, and publish updated assets when needed.

Submission is not approval. Follow the current [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), and [developer policies](https://docs.obsidian.md/community-directory/developer-policies). Requirements may change before submission.
