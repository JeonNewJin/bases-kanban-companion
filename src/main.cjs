'use strict';

const { Plugin, PluginSettingTab, Setting, FuzzySuggestModal, Modal, TFile, TFolder, Notice, stringifyYaml, apiVersion, getFrontMatterInfo, parseYaml, parsePropertyId, parseLinktext, Value, moment } = require('obsidian');
const { DEFAULT_SETTINGS, clone, cleanFolder, validateSettings, migrateSettings, taskFrontmatter, taskPath } = require('./core.cjs');
const { Router } = require('./router.cjs');
const { SUPPORTED_VERSION, orderingContext, dropSlot, planOrder, applyOrder } = require('./card-order.cjs');
const { applyValueSorts, sortExplanation } = require('./value-sort.cjs');
const { templateMatches, taskFromTemplate } = require('./task-template.cjs');
const { nextIssue, mergeCounters } = require('./issue-id.cjs');
const { EmbeddedBoardButtons } = require('./embedded-board.cjs');
const { CompactCardLayout } = require('./card-layout.cjs');

class TemplatePicker extends FuzzySuggestModal {
  constructor(plugin, choose) { super(plugin.app); this.plugin = plugin; this.choose = choose; this.setPlaceholder('Choose an issue template'); }
  getItems() {
    return this.app.vault.getMarkdownFiles().filter(file => templateMatches(file.path, this.plugin.settings.templates.folder))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.choose(file); }
}

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

class BasePicker extends FuzzySuggestModal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; this.setPlaceholder('Choose a Base for custom value sorting'); }
  getItems() { return this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile && file.extension === 'base'); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { new ApplyValueSortModal(this.plugin, file).open(); }
}

class ApplyValueSortModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; this.settings = plugin.settings; }
  onOpen() {
    this.setTitle('Apply custom value sorting');
    this.contentEl.createEl('p', { text: this.file.path });
    for (const rule of this.settings.valueSorts) {
      this.contentEl.createEl('h3', { text: rule.displayName || rule.property });
      this.contentEl.createEl('p', { text: sortExplanation(rule, this.settings.cardOrdering.property) });
    }
    this.contentEl.createEl('p', { text: 'Adds numeric formula sorts before matching properties in this Base’s Kanban views. Unlisted and empty values remain last with ascending sort. Other sort precedence and table views are preserved. Task notes are unchanged. The Base YAML is reserialized; comments and formatting may change. Back up before applying.' });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Apply to this Base').setCta().onClick(async () => {
        button.setDisabled(true);
        try { await this.plugin.applyBaseValueSorts(this.file, this.settings); this.close(); }
        catch (error) { new Notice(error.message, 8000); button.setDisabled(false); }
      }));
  }
  onClose() { this.contentEl.empty(); }
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
    el.createEl('p', { text: 'Edits are a draft until Save, except Compact card layout, which saves immediately. Saving does not move existing notes. Use the review command to apply rules to existing notes. Include all destination folders in your Base filters.' });
    new Setting(el).setName('Note properties').setHeading();
    for (const [key, name] of [['project', 'Project property'], ['status', 'Status property']]) {
      const field = new Setting(el).setName(name);
      field.addText(text => text.setValue(this.draft.properties[key]).onChange(value => { this.draft.properties[key] = value; }));
    }
    new Setting(el).setName('Issue templates').setHeading();
    let templateFolder;
    new Setting(el).setName('Template folder')
      .setDesc('Optional. Leave blank to search all visible Markdown notes. Includes subfolders. Create project issue copies properties and body without changing the source template. Native Bases New is unchanged.')
      .addText(text => { templateFolder = text; text.setValue(this.draft.templates.folder).setPlaceholder('Templates').onChange(value => { this.draft.templates.folder = value; }); })
      .addButton(button => button.setButtonText('Choose folder').onClick(() => {
        new FolderPicker(this.app, path => { templateFolder.setValue(path); this.draft.templates.folder = path; }).open();
      }));
    new Setting(el).setName('Card layout').setHeading();
    new Setting(el).setName('Compact card layout')
      .setDesc('Optional, off by default. Places property blocks side by side, with labels above values, and fits the shared card height to their rows on desktop Obsidian ' + SUPPORTED_VERSION + '. Changes save and apply immediately; no Save button needed. Turning this off restores the official vertical layout and card height. Notes and sorting stay unchanged.')
      .addToggle(toggle => toggle.setValue(this.draft.compactCards.enabled).onChange(async value => {
        const draft = this.draft;
        draft.compactCards.enabled = value; toggle.setDisabled(true);
        try { await this.plugin.updateCompactCardLayout(value); }
        catch (error) {
          draft.compactCards.enabled = this.plugin.settings.compactCards.enabled;
          toggle.setValue(draft.compactCards.enabled);
          new Notice('Card layout was not saved: ' + error.message, 8000);
        } finally { toggle.setDisabled(false); }
      }));
    new Setting(el).setName('Experimental card ordering').setHeading();
    new Setting(el).setName('Reorder cards within a column')
      .setDesc('Experimental feature for desktop Obsidian ' + SUPPORTED_VERSION + ' only. Uses internal drag information; unsupported versions do nothing. Off by default. Cross-column moves stay native.')
      .addToggle(toggle => toggle.setValue(this.draft.cardOrdering.enabled).onChange(value => { this.draft.cardOrdering.enabled = value; }));
    new Setting(el).setName('Card-order property')
      .setDesc('Include this numeric property with ascending direction in the official Kanban Sort menu. Put it first for free reordering, or after other properties to reorder only matching values. A same-column drop numbers the full displayed column from 1, even at the same position if ranks need fixing; only order values change. Switching to order-only then follows the last saved display order. Limit: 200 cards; no search or result limit. Only this plugin’s unchanged custom-value formulas are supported before order; arbitrary formulas, modified-time and file-size sorts are unsupported.')
      .addText(text => text.setValue(this.draft.cardOrdering.property).onChange(value => { this.draft.cardOrdering.property = value; }));
    new Setting(el).setName('Custom value sorting').setHeading();
    el.createEl('p', { text: 'Choose a text property and define its value order. Give the generated sort option a readable name; this does not rename the note property. Save first, then apply to a Base. In the official Kanban Sort menu, select that name and add the card-order property below it with ascending direction. Existing note values are never replaced.' });
    for (const [index, rule] of this.draft.valueSorts.entries()) {
      let preview;
      const refreshPreview = () => {
        preview?.setName(rule.displayName || 'Sort rule preview').setDesc(sortExplanation(rule, this.draft.cardOrdering.property));
      };
      new Setting(el).setName('Text property').setDesc('The actual property stored in task notes, e.g. priority. This is different from the sort option name below.')
        .addText(text => text.setPlaceholder('priority').setValue(rule.property).onChange(value => { rule.property = value; refreshPreview(); }))
        .addButton(button => button.setButtonText('Remove rule').onClick(() => { this.draft.valueSorts.splice(index, 1); this.render(); }));
      new Setting(el).setName('Sort option name').setDesc('After Save → Apply to Base, select this name in the official Kanban Sort menu, then add the card-order property below it with ascending direction. This names the sort option, not the note property. Leave blank to keep the current name or generate a default.')
        .addText(text => text.setPlaceholder('우선순위: 높음 → 보통 → 낮음').setValue(rule.displayName).onChange(value => { rule.displayName = value; refreshPreview(); }));
      new Setting(el).setName('Values in display order').setDesc('One value per line, first to last. For example: 높음, 보통, 낮음 on separate lines. Change the line order to change sorting; reapply to the Base after saving.')
        .addTextArea(input => {
          input.inputEl.rows = Math.max(3, Math.min(8, rule.values.length));
          input.setValue(rule.values.join('\n')).onChange(value => { rule.values = value.split('\n').map(line => line.trim()).filter(Boolean); refreshPreview(); });
        });
      preview = new Setting(el);
      refreshPreview();
    }
    new Setting(el)
      .addButton(button => button.setButtonText('Add value-sort rule').onClick(() => {
        this.draft.valueSorts.push({ property: '', values: [], displayName: '' }); this.render();
      }))
      .addButton(button => button.setButtonText('Apply saved rules to a Base').onClick(() => this.plugin.chooseValueSortBase()));
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
      new Setting(el).setName('Project name').setDesc('English letters only; saved in uppercase (demo → DEMO). Must exactly match note project values. Existing notes are not renamed.')
        .addText(text => text.setValue(project.name).onChange(value => { project.name = value; }))
        .addToggle(toggle => toggle.setValue(project.enabled).onChange(value => { project.enabled = value; }))
        .addButton(button => button.setButtonText('Remove project').onClick(() => {
          this.draft.projects.splice(index, 1); this.render();
        }));
      this.folderField('New-task folder', project.newTaskFolder, value => { project.newTaskFolder = value; });
      el.createEl('p', { text: 'Applies only to the Create project issue command, not the built-in Bases New button. The first status below is the initial status for new issues.' });
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
    this.setTitle('Create project issue');
    this.contentEl.createEl('p', { text: 'Creates an issue_id such as PROJECT-1. The filename stays as the title. Numbers are kept after deletion; failed creation may leave a gap.' });
    this.opened = true;
    let title = '';
    let templateFile = null;
    const values = {};
    new Setting(this.contentEl).setName('Project').addDropdown(dropdown => {
      for (const project of this.plugin.settings.projects.filter(item => item.enabled)) dropdown.addOption(project.name, project.name);
      dropdown.setValue(this.projectName).onChange(value => { this.projectName = value; });
    });
    new Setting(this.contentEl).setName('Title').addText(text => text.onChange(value => { title = value; }));
    const templateSetting = new Setting(this.contentEl).setName('Template');
    const describeTemplate = () => templateSetting.setDesc(templateFile ? templateFile.path : 'No template — use the built-in issue layout.');
    describeTemplate();
    templateSetting
      .addButton(button => button.setButtonText('Choose template').onClick(() => {
        const picker = new TemplatePicker(this.plugin, file => {
          if (this.opened) { templateFile = file; describeTemplate(); }
        });
        if (!picker.getItems().length) return new Notice('No Markdown templates found. Check the template folder in settings.');
        picker.open();
      }))
      .addButton(button => button.setButtonText('Clear').onClick(() => { templateFile = null; describeTemplate(); }));
    for (const rule of this.plugin.settings.valueSorts) {
      new Setting(this.contentEl).setName(rule.property).addDropdown(dropdown => {
        dropdown.addOption('', 'Use template value / not set');
        for (const value of rule.values) dropdown.addOption(value, value);
        dropdown.setValue('').onChange(value => { if (value) values[rule.property] = value; else delete values[rule.property]; });
      });
    }
    new Setting(this.contentEl).addButton(button => button.setButtonText('Create').setCta().onClick(async () => {
      button.setDisabled(true);
      try {
        const file = await this.plugin.createTask(this.projectName, title, values, templateFile);
        this.close();
        await this.app.workspace.getLeaf(false).openFile(file);
      } catch (error) { new Notice(error.message); button.setDisabled(false); }
    }));
  }
  onClose() { this.opened = false; this.contentEl.empty(); }
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
    this.writeQueue = Promise.resolve();
    try { this.settings = migrateSettings(await this.loadData()); }
    catch (error) {
      this.settings = clone(DEFAULT_SETTINGS);
      new Notice('Invalid settings. Routing is disabled until you review and save your settings: ' + error.message, 10000);
      // Keep the invalid file intact for recovery; do not silently replace it.
    }
    if (this.settings.projects.some(project => !/^[A-Z]+$/.test(project.name))) {
      new Notice('Existing project names were preserved. Use uppercase English project names and matching note project values before creating new issues.', 10000);
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
    this.app.workspace.onLayoutReady(() => { if (this.router.active) { this.ready = true; this.setupCardOrdering(); this.setupEmbeddedBoardButtons(); this.setupCompactCardLayout(); } });
    this.addCommand({ id: 'review-pending-moves', name: 'Review pending moves', callback: () => new ReviewModal(this).open() });
    // Keep the command ID stable for existing hotkeys.
    this.addCommand({ id: 'create-project-task', name: 'Create project issue', callback: () => {
      if (!this.settings.projects.some(project => project.enabled)) return new Notice('Add and save a project in the plugin settings first.');
      new NewTaskModal(this).open();
    } });
    this.addCommand({ id: 'undo-card-reorder', name: 'Undo last card reorder', callback: () => this.undoCardOrder() });
    this.addCommand({ id: 'apply-value-sorts', name: 'Apply custom value sorting to Base', callback: () => this.chooseValueSortBase() });
  }
  onunload() { this.ready = false; this.cardLayout?.stop(); this.boardButtons?.stop(); this.clearOrderMarker(); this.router?.stop(); }
  serializeChange(operation) {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.catch(() => {});
    return result;
  }
  updateSettings(draft) {
    return this.serializeChange(async () => {
      const settings = validateSettings(draft);
      for (const old of this.settings.projects) {
        if (old.name === old.name.toUpperCase() || !settings.projects.some(project => project.name === old.name.toUpperCase())) continue;
        for (const file of this.app.vault.getMarkdownFiles()) {
          const info = getFrontMatterInfo(await this.app.vault.read(file));
          if (info.exists && info.frontmatter.includes(old.name) && parseYaml(info.frontmatter)?.[this.settings.properties.project] === old.name) {
            throw new Error('Update existing note project values from ' + old.name + ' to ' + old.name.toUpperCase() + ' before saving. Notes are not renamed automatically.');
          }
        }
      }
      if (!this.router.active) throw new Error('Plugin inactive. Try saving again after reloading.');
      settings.issueCounters = mergeCounters(this.settings.issueCounters, settings.issueCounters);
      await this.saveData(settings);
      this.settings = settings;
      this.cardLayout?.setEnabled(settings.compactCards.enabled);
      this.cardUndo = null;
      this.clearOrderMarker();
      this.router.conflicts.clear();
    });
  }
  updateCompactCardLayout(enabled) {
    return this.serializeChange(async () => {
      if (!this.router.active) throw new Error('Plugin inactive. Try again after reloading.');
      // Read current settings inside the shared queue. Never save unrelated
      // draft fields or overwrite concurrent rule/counter changes.
      const settings = validateSettings({ ...this.settings, compactCards: { enabled } }, { preserveProjectNames: true });
      await this.saveData(settings);
      if (!this.router.active) return;
      this.settings.compactCards = settings.compactCards;
      this.cardLayout?.setEnabled(enabled);
    });
  }
  chooseValueSortBase() {
    if (!this.settings.valueSorts.length) return new Notice('Add and save a custom value-sort rule first.');
    if (apiVersion !== SUPPORTED_VERSION) return new Notice('Custom value sorting setup requires desktop Obsidian ' + SUPPORTED_VERSION + '.');
    new BasePicker(this).open();
  }
  async applyBaseValueSorts(file, settings) {
    if (!(file instanceof TFile) || file.extension !== 'base') throw new Error('Choose an existing Base file.');
    if (!this.ready || this.settings !== settings || apiVersion !== SUPPORTED_VERSION) throw new Error('Settings changed or plugin inactive. Try again.');
    await this.app.vault.process(file, content => {
      if (!this.ready || this.settings !== settings || this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('Base or settings changed. Try again.');
      const original = parseYaml(content), next = applyValueSorts(original, settings);
      return JSON.stringify(original) === JSON.stringify(next) ? content : stringifyYaml(next);
    });
    this.cardUndo = null;
    new Notice('Custom value sorting applied to ' + file.path + '. Task note values are unchanged.');
  }
  setupCardOrdering() {
    const doc = this.app.workspace.containerEl?.ownerDocument;
    if (!doc) return;
    this.registerDomEvent(doc, 'dragover', event => this.onCardOrderEvent(event, false), { capture: true });
    this.registerDomEvent(doc, 'drop', event => this.onCardOrderEvent(event, true), { capture: true });
    this.registerDomEvent(doc, 'dragend', () => this.clearOrderMarker(), { capture: true });
    this.registerDomEvent(doc, 'dragleave', event => { if (!event.relatedTarget) this.clearOrderMarker(); }, { capture: true });
  }
  setupEmbeddedBoardButtons() {
    if (this.boardButtons) return;
    const workspace = this.app.workspace;
    this.boardButtons = new EmbeddedBoardButtons({
      version: apiVersion,
      getScopes: () => {
        const scopes = [];
        workspace.iterateAllLeaves(leaf => {
          const view = leaf.view;
          if (view.getViewType() === 'markdown' && view.file instanceof TFile && view.file.extension === 'md') {
            scopes.push({ root: view.containerEl, sourcePath: view.file.path });
          }
        });
        return scopes;
      },
      parseLink: parseLinktext,
      resolve: (link, source) => this.app.metadataCache.getFirstLinkpathDest(link, source),
      current: file => file instanceof TFile && this.app.vault.getAbstractFileByPath(file.path) === file,
      open: (link, source) => workspace.openLinkText(link, source, 'tab'),
      notice: text => new Notice(text, 8000)
    });
    const refresh = () => this.boardButtons.schedule();
    for (const event of ['layout-change', 'active-leaf-change', 'file-open', 'window-open', 'window-close']) this.registerEvent(workspace.on(event, refresh));
    this.boardButtons.refresh();
  }
  setupCompactCardLayout() {
    if (this.cardLayout) return;
    const workspace = this.app.workspace;
    this.cardLayout = new CompactCardLayout({
      version: apiVersion,
      enabled: this.settings.compactCards.enabled,
      getRoots: () => {
        const roots = [];
        workspace.iterateAllLeaves(leaf => {
          if (['markdown', 'bases'].includes(leaf.view.getViewType()) && leaf.view.containerEl) roots.push(leaf.view.containerEl);
        });
        return roots;
      },
      redraw: () => workspace.trigger('css-change')
    });
    for (const event of ['layout-change', 'active-leaf-change', 'file-open', 'window-open', 'window-close', 'css-change']) {
      this.registerEvent(workspace.on(event, () => this.cardLayout.schedule()));
    }
    this.cardLayout.refresh();
  }
  clearOrderMarker() { this.orderMarker?.remove(); this.orderMarker = null; }
  onCardOrderEvent(event, dropping) {
    this.clearOrderMarker();
    if (!this.ready || event.defaultPrevented) return;
    const settings = this.settings;
    try {
      const context = orderingContext(this.app, settings, apiVersion, this.app.dragManager?.draggable, event.target, { parsePropertyId, equalValues: Value.equals });
      if (!context) return;
      const { view, column, files, moved, direction, constraints } = context;
      const top = column.innerEl.getBoundingClientRect().top;
      const slot = dropSlot(event.clientY, top, view.measurements.cardHeight, view.measurements.cardGap, files.length);
      const plan = planOrder(files, moved, slot, direction, settings, file => this.app.metadataCache.getFileCache(file)?.frontmatter, constraints);
      if (!plan) return;
      event.preventDefault();
      if (dropping) {
        event.stopPropagation();
        if (this.orderBusy) return new Notice('A card reorder is still saving. Try again shortly.');
        const sort = JSON.stringify(view.config.getSort()), group = view.config.groupBy.property;
        void this.saveCardOrder(plan, () => view.containerEl?.isConnected === true
          && JSON.stringify(view.config.getSort()) === sort && view.config.groupBy?.property === group
          && view.config.getLimit() === 0 && !view.queryController.getSearchQuery()?.trim());
      } else {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const rect = column.contentEl.getBoundingClientRect();
        const markerY = top + slot * (view.measurements.cardHeight + view.measurements.cardGap) - view.measurements.cardGap / 2;
        if (markerY < rect.top || markerY > rect.bottom) return;
        const doc = event.target.ownerDocument;
        this.orderMarker = doc.createElement('div');
        this.orderMarker.className = 'bkc-order-marker';
        this.orderMarker.style.top = markerY + 'px';
        this.orderMarker.style.left = rect.left + 'px';
        this.orderMarker.style.width = rect.width + 'px';
        doc.body.appendChild(this.orderMarker);
      }
    } catch (error) { if (dropping) new Notice('Card order unchanged: ' + error.message, 8000); }
  }
  cardOrderIO() {
    return {
      currentFile: file => file instanceof TFile && this.app.vault.getAbstractFileByPath(file.path) === file,
      read: async file => {
        const info = getFrontMatterInfo(await this.app.vault.read(file));
        return info.exists ? parseYaml(info.frontmatter) ?? {} : {};
      },
      process: (file, callback) => this.app.fileManager.processFrontMatter(file, callback)
    };
  }
  async saveCardOrder(plan, viewUnchanged = () => true) {
    if (this.orderBusy) return;
    const settings = this.settings;
    this.orderBusy = true;
    try {
      const undo = await applyOrder(plan, this.cardOrderIO(), () => this.ready && this.settings === settings
        && settings.cardOrdering.enabled && apiVersion === SUPPORTED_VERSION && viewUnchanged());
      this.cardUndo = { plan: undo, settings };
      new Notice('Card order saved from 1 in displayed column order. Use Undo last card reorder to reverse it.');
    } catch (error) { new Notice('Card reorder failed: ' + error.message, 10000); }
    finally { this.orderBusy = false; }
  }
  async undoCardOrder() {
    if (this.orderBusy) return new Notice('Wait for the current card reorder to finish.');
    const last = this.cardUndo;
    if (!last || last.settings !== this.settings) return new Notice('No card reorder to undo in this session.');
    this.orderBusy = true;
    try {
      await applyOrder(last.plan, this.cardOrderIO(), () => this.ready && this.settings === last.settings);
      this.cardUndo = null;
      new Notice('Last card reorder undone.');
    } catch (error) { new Notice('Cannot undo card reorder: ' + error.message, 10000); }
    finally { this.orderBusy = false; }
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
  createTask(projectName, title, values = {}, templateFile = null) {
    // One queue also serializes settings persistence with ID reservations.
    return this.serializeChange(() => this.createIssue(projectName, title, values, templateFile));
  }
  async existingIssueMetadata(settings) {
    const result = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!templateMatches(file.path, '')) continue;
      if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the issue again.');
      const info = getFrontMatterInfo(await this.app.vault.read(file));
      if (!info.exists || !info.frontmatter.includes('issue_id')) continue;
      try { result.push(parseYaml(info.frontmatter)); }
      catch { throw new Error('Cannot check issue identifiers in ' + file.path + '. Fix its frontmatter before creating an issue.'); }
    }
    return result;
  }
  async createIssue(projectName, title, values, templateFile) {
    const settings = this.settings;
    const path = taskPath(projectName, title, settings);
    nextIssue(projectName, settings.issueCounters, []);
    const fm = taskFrontmatter(projectName, settings);
    for (const [property, value] of Object.entries(values)) {
      if (!settings.valueSorts.some(rule => rule.property === property && rule.values.includes(value))) throw new Error('Choose a configured property value.');
      fm[property] = value;
    }
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note with this title already exists.');
    const sourcePath = templateFile?.path;
    const sourceMtime = templateFile?.stat?.mtime;
    const sourceSize = templateFile?.stat?.size;
    const checkTemplate = () => {
      if (templateFile && (!(templateFile instanceof TFile) || !templateMatches(templateFile.path, settings.templates.folder)
        || templateFile.path !== sourcePath || this.app.vault.getAbstractFileByPath(sourcePath) !== templateFile
        || templateFile.stat?.mtime !== sourceMtime || templateFile.stat?.size !== sourceSize)) {
        throw new Error('The template changed or is outside the template folder. Choose it again.');
      }
    };
    checkTemplate();
    const templateContent = templateFile ? await this.app.vault.read(templateFile) : null;
    const api = { getFrontMatterInfo, parseYaml, stringifyYaml, now: moment() };
    const render = () => templateFile
      ? taskFromTemplate(templateContent, path.split('/').pop().slice(0, -3), fm, api)
      : '---\n' + stringifyYaml(fm) + '---\n\n## Task\n\n## Acceptance criteria\n\n- [ ] \n';
    render(); // Validate the template before reserving an identifier or creating folders.
    checkTemplate();
    if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the task again.');
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
    if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the task again.');
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note with this title already exists.');
    checkTemplate();
    const issue = nextIssue(projectName, settings.issueCounters, await this.existingIssueMetadata(settings));
    if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the issue again.');
    checkTemplate();
    fm.issue_id = issue.id;
    const content = render();
    // Advance before persisting: a partially failed write must not reuse a reservation.
    settings.issueCounters = { ...settings.issueCounters, [projectName]: issue.number };
    await this.saveData(settings);
    if (!this.router.active || this.settings !== settings) throw new Error('Settings changed. Try creating the issue again.');
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A note with this title already exists.');
    checkTemplate();
    return this.app.vault.create(path, content);
  }
};
