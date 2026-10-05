'use strict';

const { Plugin, PluginSettingTab, Setting, FuzzySuggestModal, Modal, TFile, TFolder, Notice, stringifyYaml } = require('obsidian');
const { DEFAULT_SETTINGS, clone, cleanFolder, validateSettings, migrateSettings, taskFrontmatter, taskPath } = require('./core.cjs');
const { Router } = require('./router.cjs');

class FolderPicker extends FuzzySuggestModal {
  constructor(app, choose) { super(app); this.choose = choose; this.setPlaceholder('Choose a folder'); }
  getItems() {
    return this.app.vault.getAllLoadedFiles().filter(file => {
      if (!(file instanceof TFolder)) return false;
      try { cleanFolder(file.path); return true; } catch { return false; }
    });
  }
  getItemText(folder) { return folder.path; }
  onChooseItem(folder) { this.choose(folder.path); }
}

class ImportModal extends Modal {
  constructor(plugin, imported) { super(plugin.app); this.imported = imported; }
  onOpen() {
    this.setTitle('Import settings');
    this.contentEl.createEl('p', { text: 'Paste version 3 settings or a version 2 Project Task Router configuration. This replaces the settings draft only. Review it and save to apply. No notes are moved by importing.' });
    let value = '';
    new Setting(this.contentEl).setName('Settings JSON').addTextArea(input => {
      input.inputEl.rows = 12;
      input.inputEl.cols = 55;
      input.onChange(text => { value = text; });
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Import to draft').setCta().onClick(() => {
      try { this.imported(migrateSettings(JSON.parse(value))); this.close(); }
      catch (error) { new Notice(error.message); }
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class SettingsTab extends PluginSettingTab {
  display() { this.draft = clone(this.plugin.settings); this.render(); }
  folderField(name, value, update) {
    let input;
    new Setting(this.containerEl).setName(name)
      .addText(text => { input = text; text.setPlaceholder('Tasks/Active').setValue(value).onChange(update); })
      .addButton(button => button.setButtonText('Choose folder').onClick(() => {
        new FolderPicker(this.app, path => { input.setValue(path); update(path); }).open();
      }));
  }
  render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('bkc-settings');
    el.createEl('p', { text: 'Move matching Markdown notes when their status changes. New installations have no rules. Only exact managed folders are included; subfolders are not included automatically.' });
    el.createEl('p', { text: 'Unsaved edits are a draft. Saving does not move existing notes. Use the review command to apply rules to existing notes. Include all destination folders in your Base filters.' });
    new Setting(el).setName('Note properties').setHeading();
    for (const [key, name] of [['project', 'Project property'], ['type', 'Type property'], ['status', 'Status property'], ['taskType', 'Required type value']]) {
      const field = new Setting(el).setName(name);
      if (key === 'taskType') field.setDesc('Leave blank to accept any type. Project and managed-folder restrictions still apply.');
      field.addText(text => text.setValue(this.draft.properties[key]).onChange(value => { this.draft.properties[key] = value; }));
    }
    new Setting(el).setName('Excluded folders').setDesc('One vault-relative folder per line. Excludes that folder and its descendants, both as sources and destinations. Add your template folder here if it overlaps a managed folder.')
      .addTextArea(input => {
        input.inputEl.rows = 3;
        input.setValue(this.draft.excludedFolders.join('\n')).onChange(value => {
          this.draft.excludedFolders = value.split('\n').map(line => line.trim()).filter(Boolean);
        });
      });
    new Setting(el).setName('Projects').setHeading();
    for (const [index, project] of this.draft.projects.entries()) {
      new Setting(el).setName(project.name || 'New project').setHeading();
      new Setting(el).setName('Project name').setDesc('Must exactly match the note property value.')
        .addText(text => text.setValue(project.name).onChange(value => { project.name = value; }))
        .addToggle(toggle => toggle.setValue(project.enabled).onChange(value => { project.enabled = value; }))
        .addButton(button => button.setButtonText('Remove project').onClick(() => {
          this.draft.projects.splice(index, 1); this.render();
        }));
      this.folderField('New-task folder', project.newTaskFolder, value => { project.newTaskFolder = value; });
      el.createEl('p', { text: 'Applies only to the Create project task command, not the built-in Bases New button. The first status below is the initial status for new tasks.' });
      for (const [routeIndex, route] of project.routes.entries()) {
        let folderInput;
        new Setting(el).setName('Status to folder')
          .addText(text => {
            text.inputEl.setAttribute('aria-label', 'Status');
            text.inputEl.addClass('bkc-status-input');
            text.setPlaceholder('Done').setValue(route.status).onChange(value => { route.status = value; });
          })
          .addText(text => {
            folderInput = text;
            text.inputEl.setAttribute('aria-label', 'Destination folder');
            text.inputEl.addClass('bkc-folder-input');
            text.setPlaceholder('Tasks/Archive').setValue(route.folder).onChange(value => { route.folder = value; });
          })
          .addButton(button => button.setButtonText('Choose folder').onClick(() => {
            new FolderPicker(this.app, path => { route.folder = path; folderInput.setValue(path); }).open();
          }))
          .addButton(button => button.setButtonText('Remove status').onClick(() => {
            project.routes.splice(routeIndex, 1); this.render();
          }));
      }
      new Setting(el).addButton(button => button.setButtonText('Add status').onClick(() => {
        project.routes.push({ status: '', folder: project.newTaskFolder }); this.render();
      }));
    }
    new Setting(el)
      .addButton(button => button.setButtonText('Add project').onClick(() => {
        this.draft.projects.push({ name: '', enabled: true, newTaskFolder: '', routes: [{ status: '', folder: '' }] });
        this.render();
      }))
      .addButton(button => button.setButtonText('Import settings').onClick(() => {
        new ImportModal(this.plugin, settings => { this.draft = settings; this.render(); }).open();
      }))
      .addButton(button => button.setButtonText('Save').setCta().onClick(async () => {
        try {
          await this.plugin.updateSettings(this.draft);
          new Notice('Settings saved. Existing notes are unchanged.');
          this.display();
        } catch (error) { new Notice(error.message); }
      }));
  }
}

class NewTaskModal extends Modal {
  constructor(plugin) {
    super(plugin.app); this.plugin = plugin;
    this.projectName = plugin.settings.projects.find(project => project.enabled)?.name;
  }
  onOpen() {
    this.setTitle('Create project task');
    let title = '';
    new Setting(this.contentEl).setName('Project').addDropdown(dropdown => {
      for (const project of this.plugin.settings.projects.filter(item => item.enabled)) dropdown.addOption(project.name, project.name);
      dropdown.setValue(this.projectName).onChange(value => { this.projectName = value; });
    });
    new Setting(this.contentEl).setName('Title').addText(text => text.onChange(value => { title = value; }));
    new Setting(this.contentEl).addButton(button => button.setButtonText('Create').setCta().onClick(async () => {
      button.setDisabled(true);
      try {
        const file = await this.plugin.createTask(this.projectName, title);
        this.close();
        await this.app.workspace.getLeaf(false).openFile(file);
      } catch (error) { new Notice(error.message); button.setDisabled(false); }
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class ReviewModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onOpen() {
    this.setTitle('Review pending moves');
    const plans = this.plugin.router.preview(this.app.vault.getMarkdownFiles());
    this.contentEl.createEl('p', { text: plans.length + ' pending moves. Conflicting destinations are skipped. Settings and note status are checked again before each move.' });
    const list = this.contentEl.createDiv({ cls: 'bkc-move-preview' });
    for (const plan of plans) list.createEl('p', { text: plan.source + ' → ' + plan.target + (plan.conflict ? ' (conflict: skipped)' : '') });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Move listed notes').setCta().setDisabled(!plans.some(plan => !plan.conflict)).onClick(async () => {
        button.setDisabled(true);
        for (const plan of plans) if (!plan.conflict) this.plugin.router.enqueue(plan.file);
        await this.plugin.router.queue;
        this.close();
        new Notice('Review complete. Any failed moves were skipped and reported.');
      }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = class BasesKanbanCompanion extends Plugin {
  async onload() {
    this.ready = false;
    try { this.settings = migrateSettings(await this.loadData()); }
    catch (error) {
      this.settings = clone(DEFAULT_SETTINGS);
      new Notice('Invalid settings. Routing is disabled until you review and save your settings: ' + error.message, 10000);
      // Keep the invalid file intact for recovery; do not silently replace it.
    }
    this.router = new Router({
      fileAt: path => this.app.vault.getAbstractFileByPath(path),
      metadata: file => this.app.metadataCache.getFileCache(file)?.frontmatter,
      ensureFolder: path => this.ensureFolder(path),
      rename: (file, target) => this.app.fileManager.renameFile(file, target),
      notice: text => new Notice(text, 8000)
    }, () => this.settings);
    this.addSettingTab(new SettingsTab(this.app, this));
    const enqueue = file => { if (this.ready && file instanceof TFile) this.router.enqueue(file); };
    this.registerEvent(this.app.metadataCache.on('changed', enqueue));
    this.registerEvent(this.app.vault.on('rename', enqueue));
    this.app.workspace.onLayoutReady(() => { if (this.router.active) this.ready = true; });
    this.addCommand({ id: 'review-pending-moves', name: 'Review pending moves', callback: () => new ReviewModal(this).open() });
    this.addCommand({ id: 'create-project-task', name: 'Create project task', callback: () => {
      if (!this.settings.projects.some(project => project.enabled)) return new Notice('Add and save a project in the plugin settings first.');
      new NewTaskModal(this).open();
    } });
  }
  onunload() { this.ready = false; this.router?.stop(); }
  async updateSettings(draft) {
    const settings = validateSettings(draft);
    await this.saveData(settings);
    this.settings = settings;
    this.router.conflicts.clear();
  }
  async ensureFolder(path) {
    const safe = cleanFolder(path);
    const parts = safe.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const part = parts.slice(0, index).join('/');
      const existing = this.app.vault.getAbstractFileByPath(part);
      if (!existing) {
        try { await this.app.vault.createFolder(part); }
        catch (error) { if (!(this.app.vault.getAbstractFileByPath(part) instanceof TFolder)) throw error; }
      } else if (!(existing instanceof TFolder)) throw new Error('Destination is not a folder: ' + part);
    }
  }
  async createTask(projectName, title) {
    const settings = this.settings;
    const path = taskPath(projectName, title, settings);
    const fm = taskFrontmatter(projectName, settings);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note with this title already exists.');
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
    if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the task again.');
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note with this title already exists.');
    return this.app.vault.create(path, '---\n' + stringifyYaml(fm) + '---\n\n## Task\n\n## Acceptance criteria\n\n- [ ] \n');
  }
};
