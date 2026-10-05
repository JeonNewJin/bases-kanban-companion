# Migrate from Project Task Router

Migration is explicit. Bases Kanban Companion does not read another plugin's files, disable it, or modify your existing configuration automatically.

1. Back up the vault. Keep a copy of `.obsidian/plugins/grid-task-router/data.json` and the original plugin files.
2. Disable **Project Task Router**. Leave its files and settings intact for rollback.
3. Install and enable **Bases Kanban Companion**. A fresh install has no routing rules.
4. Open its settings, choose **Import settings**, and paste the old `data.json` contents.
5. Check the draft before saving. Version 2 maps to the configurable `project`, `type`, and `status` properties, preserving the old required type value `작업` and all project/status/folder mappings.
6. Add any template or other excluded folders and save.
7. Test one note by changing its status. Existing notes are not moved just because you saved or restarted. Use **Review pending moves** if you want to reconcile them.

The public plugin has a different ID: `bases-kanban-companion`. Command shortcuts tied to the old plugin do not migrate automatically. Assign new shortcuts as needed.

The plugin does not rename existing notes, rewrite their frontmatter keys, or alter Base filters during import. If you change property names later, you must update your notes and Base filters separately.

To roll back, disable Bases Kanban Companion and re-enable Project Task Router. This restores the old router, not previously moved files. Restore file locations through status changes, manual moves, or your backup.

On a new device, install the plugin and configure its rules before use. Settings are stored in the plugin's `data.json`; synchronization depends on your vault's sync setup. Automated multi-device concurrency has not been verified. Avoid routing edits on the same note from multiple devices simultaneously.
