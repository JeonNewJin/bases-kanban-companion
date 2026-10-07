const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, validateSettings } = require('../src/core.cjs');

class TFolder { constructor(path) { this.path = path; } }
class TFile {
  constructor(path, fm = {}) { this.path = path; this.name = path.split('/').pop(); this.extension = path.split('.').pop(); this.parent = new TFolder(path.slice(0, path.lastIndexOf('/'))); this.fm = fm; }
}
async function fixture(saved = null) {
  const notices = [], commands = [], events = {}, entries = new Map(), tabs = [], fields = [], modals = [], pickers = [], openedFiles = [], leaves = [], openedLinks = [];
  const container = { empty() { fields.length = 0; }, addClass() {}, createEl() {} };
  const control = () => ({ inputEl: { setAttribute() {}, addClass() {} }, setValue(value) { this.value = value; return this; },
    setPlaceholder() { return this; }, onChange(callback) { this.change = callback; return this; },
    setButtonText(text) { this.text = text; return this; }, setCta() { return this; }, setDisabled() { return this; },
    onClick(callback) { this.click = callback; return this; }, addOption(value, label) { (this.options ??= []).push({ value, label }); return this; } });
  class Modal {
    constructor(app) { this.app = app; this.contentEl = container; }
    setTitle(title) { this.title = title; }
    open() { modals.push(this); this.onOpen(); }
    close() { this.onClose(); }
  }
  class FuzzySuggestModal {
    constructor(app) { this.app = app; }
    setPlaceholder(value) { this.placeholder = value; }
    open() { pickers.push(this); }
  }
  class Setting {
    constructor() { fields.push(this); this.controls = []; }
    setName(name) { this.name = name; return this; }
    setDesc(description) { this.description = description; return this; }
    setHeading() { return this; }
    addText(fn) { const c = control(); c.kind = 'text'; this.controls.push(c); fn(c); return this; }
    addTextArea(fn) { const c = control(); c.kind = 'textarea'; this.controls.push(c); fn(c); return this; }
    addButton(fn) { const c = control(); c.kind = 'button'; this.controls.push(c); fn(c); return this; }
    addToggle(fn) { const c = control(); this.controls.push(c); fn(c); return this; }
    addDropdown(fn) { const c = control(); this.controls.push(c); fn(c); return this; }
  }
  let ready;
  class Plugin {
    async loadData() { return saved; }
    async saveData(value) { this.saved = value; }
    addSettingTab(tab) { tabs.push(tab); }
    registerEvent() {}
    addCommand(command) { commands.push(command); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), {
    module, console,
    require: name => name === 'obsidian' ? {
      Plugin, TFile, TFolder, Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = container; } }, FuzzySuggestModal, Modal,
      Notice: class { constructor(text) { notices.push(text); } },
      apiVersion: '1.14.4',
      getFrontMatterInfo: text => {
        const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (match) return { exists: true, frontmatter: match[1], contentStart: match[0].length };
        return text.startsWith('{') ? { exists: true, frontmatter: text, contentStart: text.length } : { exists: false, contentStart: 0 };
      },
      parseYaml: text => {
        if (!text.trim()) return null;
        if (/^[{["\d]|^(?:null|false|true)$/.test(text.trim())) return JSON.parse(text);
        const fm = {};
        for (const line of text.trim().split('\n')) {
          const match = line.match(/^([^:]+): (.+)$/);
          if (!match) throw new Error('Invalid mock YAML');
          fm[match[1]] = JSON.parse(match[2]);
        }
        return fm;
      },
      moment: () => ({ format: value => ({ 'YYYY-MM-DD': '2026-10-05', 'HH:mm': '09:30' }[value] || value) }),
      parseLinktext: link => { const index = link.indexOf('#'); return index < 0 ? { path: link, subpath: '' } : { path: link.slice(0, index), subpath: link.slice(index) }; },
      parsePropertyId: id => id.includes('.') ? { type: id.split('.')[0], name: id.split('.').slice(1).join('.') } : { type: 'note', name: id },
      Value: { equals: (a, b) => a === b },
      stringifyYaml: fm => fm.views ? JSON.stringify(fm) : Object.entries(fm).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n'
    } : require(path.join(__dirname, '../src', name))
  });
  const plugin = new module.exports();
  plugin.app = {
    vault: {
      on: (event, callback) => { events[event] = callback; },
      getAbstractFileByPath: path => entries.get(path),
      getMarkdownFiles: () => [...entries.values()].filter(file => file instanceof TFile && file.extension === 'md'),
      read: async file => file.content ?? JSON.stringify(file.fm),
      process: async (file, callback) => { file.content = callback(file.content); },
      createFolder: async path => entries.set(path, new TFolder(path)),
      create: async (path, content) => { assert.equal(entries.has(path), false); const file = new TFile(path); file.content = content; entries.set(path, file); return file; }
    },
    metadataCache: { on: (event, callback) => { events[event] = callback; }, getFileCache: file => ({ frontmatter: file.fm }), getFirstLinkpathDest: path => entries.get(path) },
    workspace: { onLayoutReady: callback => { ready = callback; }, getLeaf: () => ({ openFile: async file => openedFiles.push(file) }),
      on: (event, callback) => { events['workspace:' + event] = callback; }, iterateAllLeaves: callback => leaves.forEach(callback),
      openLinkText: async (link, source, target) => openedLinks.push({ link, source, target }) },
    fileManager: { processFrontMatter: async (file, callback) => {
      const fm = { ...file.fm }; callback(fm); file.fm = fm;
    }, renameFile: async (file, target) => {
      assert.equal(entries.has(target), false); entries.delete(file.path); file.path = target;
      file.parent = entries.get(target.slice(0, target.lastIndexOf('/'))); entries.set(target, file);
    } }
  };
  await plugin.onload();
  return { plugin, notices, commands, events, entries, tabs, fields, modals, pickers, openedFiles, leaves, openedLinks, ready: () => ready() };
}
const settings = () => validateSettings({ ...DEFAULT_SETTINGS, projects: [{ name: 'EXAMPLE', enabled: true, newTaskFolder: 'Tasks/Active',
  routes: [{ status: 'To do', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }] }] });

test('loading is read-only and registers commands; fresh installs have no rules', async () => {
  const f = await fixture();
  assert.equal(f.plugin.settings.projects.length, 0); assert.equal(f.plugin.saved, undefined);
  assert.deepEqual(f.commands.map(command => command.id), ['review-pending-moves', 'create-project-task', 'undo-card-reorder', 'apply-value-sorts']);
  assert.equal(f.commands[1].name, 'Create project issue');
  f.commands[1].callback(); assert.match(f.notices[0], /Add and save/);
});

test('Kanban helpers track Markdown and Bases leaves, open embeds in a new tab and stop on unload', async () => {
  const f = await fixture(settings()); f.ready();
  assert.equal(f.plugin.kanbanTracker.features.length, 2);
  assert.equal(f.plugin.kanbanTracker.features[0], f.plugin.boardButtons); assert.equal(f.plugin.kanbanTracker.features[1], f.plugin.cardLayout);
  const note = new TFile('Notes/Project.md'), base = new TFile('Boards/Board.base'), image = new TFile('Notes/Image.png');
  f.entries.set(note.path, note); f.entries.set(base.path, base);
  const markdownRoot = { isConnected: true }, basesRoot = { isConnected: true };
  f.leaves.push({ view: { getViewType: () => 'markdown', file: note, containerEl: markdownRoot } });
  f.leaves.push({ view: { getViewType: () => 'bases', file: base, containerEl: basesRoot } });
  f.leaves.push({ view: { getViewType: () => 'image', file: image, containerEl: { isConnected: true } } });
  const leaves = f.plugin.kanbanTracker.io.getLeaves();
  assert.equal(leaves.length, 2);
  assert.equal(leaves[0].root, markdownRoot); assert.equal(leaves[0].sourcePath, note.path);
  assert.equal(leaves[1].root, basesRoot); assert.equal(leaves[1].sourcePath, null);
  await f.plugin.boardButtons.io.open(base.path, note.path);
  assert.deepEqual(f.openedLinks, [{ link: base.path, source: note.path, target: 'tab' }]);
  for (const event of ['layout-change', 'active-leaf-change', 'file-open', 'window-open', 'window-close', 'css-change']) assert.equal(typeof f.events['workspace:' + event], 'function');
  f.plugin.onunload();
  assert.equal(f.plugin.kanbanTracker.active, false); assert.equal(f.plugin.boardButtons.active, false); assert.equal(f.plugin.cardLayout.active, false);
});

test('startup metadata is ignored, then later edits route; unload blocks events', async () => {
  const f = await fixture(settings());
  const file = new TFile('Tasks/Active/Task.md', { project: 'EXAMPLE', type: 'task', status: 'Done' });
  f.entries.set(file.path, file);
  f.events.changed(file); await f.plugin.router.queue; assert.equal(file.path, 'Tasks/Active/Task.md');
  f.ready(); assert.equal(file.path, 'Tasks/Active/Task.md');
  f.events.changed(file); await f.plugin.router.queue; assert.equal(file.path, 'Tasks/Archive/Task.md');
  f.plugin.onunload(); file.fm.status = 'To do'; f.events.changed(file); await f.plugin.router.queue;
  assert.equal(file.path, 'Tasks/Archive/Task.md');
});

test('compact card toggle saves immediately without saving other drafts or touching notes', async () => {
  const f = await fixture(settings()); f.ready(); f.tabs[0].display();
  const field = f.fields.find(field => field.name === 'Compact card layout');
  assert.ok(field); assert.equal(field.controls[0].value, false);
  assert.match(field.description, /side by side/); assert.match(field.description, /restores.*vertical.*height/);
  assert.equal(f.plugin.cardLayout.enabled, false);
  f.tabs[0].draft.templates.folder = 'Unsaved';
  await field.controls[0].change(true);
  assert.equal(f.plugin.saved.compactCards.enabled, true); assert.equal(f.plugin.cardLayout.enabled, true);
  assert.equal(f.plugin.saved.templates.folder, ''); assert.equal(f.tabs[0].draft.templates.folder, 'Unsaved');
  await field.controls[0].change(false);
  assert.equal(f.plugin.cardLayout.enabled, false); assert.equal(f.entries.size, 0);
  const restored = await fixture(f.plugin.saved); restored.ready(); assert.equal(restored.plugin.cardLayout.enabled, false);
});

test('layout toggle persistence failure restores the control and keeps saved/runtime settings', async () => {
  const f = await fixture(settings()); f.ready(); f.tabs[0].display();
  const toggle = f.fields.find(field => field.name === 'Compact card layout').controls[0];
  f.plugin.saveData = async () => { throw new Error('Storage unavailable'); };
  await toggle.change(true);
  assert.equal(toggle.value, false); assert.equal(f.tabs[0].draft.compactCards.enabled, false);
  assert.equal(f.plugin.settings.compactCards.enabled, false); assert.equal(f.plugin.cardLayout.enabled, false);
  assert.match(f.notices.at(-1), /Storage unavailable/);
});

test('layout-only writes serialize with settings and keep other saved rules and counters', async () => {
  const f = await fixture(settings()); f.ready();
  const draft = settings(); draft.templates.folder = 'New templates'; draft.issueCounters = { EXAMPLE: 20 };
  await Promise.all([f.plugin.updateSettings(draft), f.plugin.updateCompactCardLayout(true), f.plugin.updateCompactCardLayout(false)]);
  assert.equal(f.plugin.saved.compactCards.enabled, false);
  assert.equal(f.plugin.saved.templates.folder, 'New templates'); assert.equal(f.plugin.saved.issueCounters.EXAMPLE, 20);
});

test('invalid saved configuration is not overwritten and cannot move notes', async () => {
  const f = await fixture({ version: 3, projects: 'corrupt' });
  assert.equal(f.plugin.saved, undefined); assert.equal(f.plugin.settings.projects.length, 0);
  assert.match(f.notices[0], /Routing is disabled/);
});

test('saving validates before persistence and does not scan existing notes', async () => {
  const f = await fixture(settings());
  const file = new TFile('Tasks/Active/Task.md', { project: 'EXAMPLE', type: 'task', status: 'Done' });
  f.entries.set(file.path, file); f.ready();
  await assert.rejects(f.plugin.updateSettings({ projects: 'invalid' }));
  assert.equal(f.plugin.saved, undefined);
  await f.plugin.updateSettings(settings()); await f.plugin.router.queue;
  assert.equal(file.path, 'Tasks/Active/Task.md'); assert.equal(f.plugin.saved.version, 3);
});

test('creation sets properties, creates parent folders, and rejects duplicate titles', async () => {
  const f = await fixture(settings()); f.ready();
  const note = await f.plugin.createTask('EXAMPLE', 'A new task');
  assert.equal(note.path, 'Tasks/Active/A new task.md');
  for (const text of ['project: "EXAMPLE"', 'status: "To do"']) assert.ok(note.content.includes(text));
  assert.equal(note.content.includes('type:'), false);
  assert.ok(f.entries.get('Tasks') instanceof TFolder); assert.ok(f.entries.get('Tasks/Active') instanceof TFolder);
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'A new task'), /already exists/);
  await assert.rejects(f.plugin.createTask('EXAMPLE', '../escape'));
});

test('changing settings during folder creation cancels task creation', async () => {
  const f = await fixture(settings());
  f.plugin.ensureFolder = async () => { f.plugin.settings = settings(); };
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'A new task'), /Settings changed/);
  assert.equal(f.entries.size, 0);
});

const addTemplate = (f, content, path = 'Templates/Task.md') => {
  const file = new TFile(path); file.content = content; file.stat = { mtime: 1, size: content.length };
  f.entries.set(path, file); return file;
};

test('template creation keeps any template type, even with a legacy restriction; explicit values win', async () => {
  const s = settings(); s.templates.folder = 'Templates'; s.properties.taskType = '';
  s.valueSorts = [{ property: 'priority', displayName: '', values: ['High', 'Low'] }];
  const f = await fixture(s);
  const source = addTemplate(f, '---\n{"project":"Other","status":"Done","type":"feature","priority":"Low","up":["[[Parent]]"]}\n---\n\n# {{title}}\n{{date}}\n- [ ] Keep this\n');
  const before = source.content;
  const task = await f.plugin.createTask('EXAMPLE', 'New feature.md', { priority: 'High' }, source);
  for (const text of ['project: "EXAMPLE"', 'status: "To do"', 'type: "feature"', 'priority: "High"', 'up: ["[[Parent]]"]', '# New feature\n2026-10-05\n- [ ] Keep this']) assert.ok(task.content.includes(text), text);
  assert.equal(source.content, before); assert.equal(task.content.includes('## Task'), false);
  await f.plugin.updateSettings({ ...s, properties: { ...s.properties, taskType: 'required' } });
  const required = await f.plugin.createTask('EXAMPLE', 'Template type', {}, source);
  assert.ok(required.content.includes('type: "feature"')); assert.ok(required.content.includes('priority: "Low"'));
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'New feature', {}, source), /already exists/);
  assert.equal(source.content, before);
});

test('settings no longer expose the required-type filter or its property-name field', async () => {
  const f = await fixture(settings()); f.tabs[0].display();
  assert.equal(f.fields.some(field => ['Required type value', 'Type property'].includes(field.name)), false);
  assert.ok(f.fields.some(field => field.name === 'Project property'));
  assert.ok(f.fields.some(field => field.name === 'Status property'));
});

test('template errors and invalid sources cannot create task files or folders', async () => {
  for (const [path, content] of [['Templates/Bad.md', '---\n[]\n---\nBody'], ['Templates/Script.md', '<% tp.file.title %>'], ['Elsewhere/Task.md', 'Body'], ['Templates/Task.base', 'Body']]) {
    const s = settings(); s.templates.folder = 'Templates';
    const f = await fixture(s); const source = addTemplate(f, content, path);
    await assert.rejects(f.plugin.createTask('EXAMPLE', 'Bad task', {}, source));
    assert.equal(f.entries.size, 1);
  }
});

test('template changes during reads or folder creation cancel creation without overwriting the source', async () => {
  for (const phase of ['read', 'folders']) {
    for (const mutation of ['delete', 'rename', 'edit', 'settings', 'unload']) {
      const f = await fixture(settings()); const source = addTemplate(f, '# {{title}}');
      const mutate = () => {
        if (mutation === 'delete') f.entries.delete(source.path);
        if (mutation === 'rename') source.path = 'Templates/Renamed.md';
        if (mutation === 'edit') source.stat.mtime++;
        if (mutation === 'settings') f.plugin.settings = settings();
        if (mutation === 'unload') f.plugin.onunload();
      };
      if (phase === 'read') f.plugin.app.vault.read = async file => { mutate(); return file.content; };
      else f.plugin.ensureFolder = async () => { mutate(); };
      await assert.rejects(f.plugin.createTask('EXAMPLE', 'Canceled', {}, source), /template|Settings changed/i);
      assert.equal(f.entries.has('Tasks/Active/Canceled.md'), false);
      assert.equal(source.content, '# {{title}}');
    }
  }
});

test('creation modal searches scoped templates by path, applies selection and supports clearing it', async () => {
  const s = settings(); s.templates.folder = 'Templates';
  const f = await fixture(s);
  const source = addTemplate(f, '# Chosen {{title}}', 'Templates/A/Task.md');
  addTemplate(f, 'Other', 'Templates/B/Task.md'); addTemplate(f, 'Hidden', 'Templates/.hidden.md'); addTemplate(f, 'Outside', 'Notes/Task.md');
  f.commands.find(command => command.id === 'create-project-task').callback();
  assert.equal(f.modals.at(-1).title, 'Create project issue');
  f.fields.find(field => field.name === 'Title').controls[0].change('First task');
  const field = f.fields.find(field => field.name === 'Template');
  field.controls.find(c => c.text === 'Choose template').click();
  const picker = f.pickers.at(-1);
  assert.deepEqual(Array.from(picker.getItems(), file => picker.getItemText(file)), ['Templates/A/Task.md', 'Templates/B/Task.md']);
  picker.onChooseItem(source); assert.equal(field.description, source.path);
  await f.fields.flatMap(field => field.controls).find(c => c.text === 'Create').click();
  assert.ok(f.openedFiles[0].content.includes('# Chosen First task'));
  f.commands.find(command => command.id === 'create-project-task').callback();
  f.fields.find(field => field.name === 'Title').controls[0].change('No template');
  const second = f.fields.find(field => field.name === 'Template');
  second.controls.find(c => c.text === 'Choose template').click();
  f.pickers.at(-1).onChooseItem(source);
  second.controls.find(c => c.text === 'Clear').click();
  await f.fields.flatMap(field => field.controls).find(c => c.text === 'Create').click();
  assert.ok(f.openedFiles[1].content.includes('## Task')); assert.equal(f.openedFiles[1].content.includes('# Chosen'), false);
});

test('empty template folders show guidance and the optional folder setting persists without moving notes', async () => {
  const f = await fixture(settings());
  f.commands.find(command => command.id === 'create-project-task').callback();
  f.fields.find(field => field.name === 'Template').controls[0].click();
  assert.match(f.notices.at(-1), /No Markdown templates/); assert.equal(f.pickers.length, 0);
  f.modals.at(-1).close();
  f.tabs[0].display();
  f.fields.find(field => field.name === 'Template folder').controls[0].change('Templates/Tasks');
  await f.fields.flatMap(field => field.controls).find(c => c.text === 'Save').click();
  assert.equal(f.plugin.saved.templates.folder, 'Templates/Tasks'); assert.equal(f.entries.size, 0);
});

const issueId = file => JSON.parse(file.content.match(/^issue_id: (.+)$/m)[1]);

test('new issues get IDs only in frontmatter, per project, and simultaneous requests are serialized', async () => {
  const s = settings(); s.projects.push({ ...s.projects[0], name: 'SECOND' });
  const f = await fixture(s);
  const [first, second] = await Promise.all([f.plugin.createTask('EXAMPLE', 'One'), f.plugin.createTask('EXAMPLE', 'Two')]);
  assert.equal(first.path, 'Tasks/Active/One.md'); assert.equal(second.path, 'Tasks/Active/Two.md');
  assert.equal(issueId(first), 'EXAMPLE-1'); assert.equal(issueId(second), 'EXAMPLE-2');
  assert.equal(issueId(await f.plugin.createTask('SECOND', 'Other')), 'SECOND-1');
  assert.equal(f.plugin.saved.issueCounters.EXAMPLE, 2);
  const reopened = await fixture(f.plugin.saved);
  assert.equal(issueId(await reopened.plugin.createTask('EXAMPLE', 'After restart')), 'EXAMPLE-3');
});

test('existing IDs anywhere in the vault prevent reuse, but original cards and templates are unchanged', async () => {
  const f = await fixture(settings());
  const archived = addTemplate(f, '---\n{"issue_id":"EXAMPLE-12"}\n---\nKeep', 'Elsewhere/Archived.md');
  const source = addTemplate(f, '---\n{"issue_id":"STALE-999"}\n---\nTemplate');
  f.plugin.settings.templates.folder = 'Templates';
  const original = new TFile('Tasks/Active/Old.md', { project: 'EXAMPLE', type: 'task', status: 'To do' });
  f.entries.set(original.path, original);
  const result = await f.plugin.createTask('EXAMPLE', 'New', {}, source);
  assert.equal(issueId(result), 'EXAMPLE-13'); assert.ok(result.content.endsWith('Template'));
  assert.equal(Object.hasOwn(original.fm, 'issue_id'), false); assert.ok(archived.content.endsWith('Keep'));
  assert.ok(source.content.includes('STALE-999'));
  f.entries.delete(result.path); f.entries.delete(archived.path);
  assert.equal(issueId(await f.plugin.createTask('EXAMPLE', 'Next')), 'EXAMPLE-14');
});

test('invalid creation does not consume a number, but a reserved number is retained after file or persistence failure', async () => {
  const f = await fixture(settings());
  await assert.rejects(f.plugin.createTask('EXAMPLE', '../Bad')); assert.deepEqual(f.plugin.settings.issueCounters, {});
  const create = f.plugin.app.vault.create;
  f.plugin.app.vault.create = async () => { throw new Error('Disk failure'); };
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'Failed'), /Disk failure/);
  assert.equal(f.plugin.saved.issueCounters.EXAMPLE, 1);
  f.plugin.app.vault.create = create;
  assert.equal(issueId(await f.plugin.createTask('EXAMPLE', 'Next')), 'EXAMPLE-2');
  const save = f.plugin.saveData.bind(f.plugin);
  f.plugin.saveData = async () => { throw new Error('Save failure'); };
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'Unsaved'), /Save failure/);
  assert.equal(f.entries.has('Tasks/Active/Unsaved.md'), false);
  f.plugin.saveData = save;
  assert.equal(issueId(await f.plugin.createTask('EXAMPLE', 'After failure')), 'EXAMPLE-4');
});

test('stale settings drafts, imports, project removal and concurrent saves cannot roll back issue counters', async () => {
  const f = await fixture(settings());
  const draft = JSON.parse(JSON.stringify(f.plugin.settings));
  const [file] = await Promise.all([f.plugin.createTask('EXAMPLE', 'One'), f.plugin.updateSettings(draft)]);
  assert.equal(issueId(file), 'EXAMPLE-1'); assert.equal(f.plugin.saved.issueCounters.EXAMPLE, 1);
  await f.plugin.updateSettings({ ...draft, projects: [] });
  await f.plugin.updateSettings(draft);
  assert.equal(issueId(await f.plugin.createTask('EXAMPLE', 'Two')), 'EXAMPLE-2');
});

test('legacy project names stay unchanged on load and are blocked for new IDs; case migration never silently breaks existing notes', async () => {
  const s = settings(); s.projects[0].name = 'Example';
  const f = await fixture(s);
  assert.equal(f.plugin.settings.projects[0].name, 'Example'); assert.equal(f.plugin.saved, undefined);
  assert.match(f.notices.at(-1), /project names/i);
  await assert.rejects(f.plugin.createTask('Example', 'New'), /uppercase|English/i);
  const existing = new TFile('Tasks/Active/Old.md', { project: 'Example', status: 'To do', type: 'task' });
  f.entries.set(existing.path, existing);
  await assert.rejects(f.plugin.updateSettings(s), /existing.*project|note.*project/i);
  assert.equal(existing.fm.project, 'Example');
  existing.fm.project = 'EXAMPLE';
  await f.plugin.updateSettings(s);
  assert.equal(f.plugin.settings.projects[0].name, 'EXAMPLE');
});

test('all existing IDs including templates count as reserved, and IDs survive routing to archives', async () => {
  const f = await fixture(settings()); f.ready();
  const source = addTemplate(f, '---\n{"issue_id":"EXAMPLE-20"}\n---\nSource');
  f.plugin.settings.templates.folder = 'Templates';
  const note = await f.plugin.createTask('EXAMPLE', 'New', {}, source);
  assert.equal(issueId(note), 'EXAMPLE-21');
  note.fm = { project: 'EXAMPLE', type: 'task', status: 'Done', issue_id: issueId(note) };
  f.events.changed(note); await f.plugin.router.queue;
  assert.equal(note.path, 'Tasks/Archive/New.md'); assert.equal(issueId(note), 'EXAMPLE-21');
});

test('collisions and unloading while persisting a reservation do not create or overwrite notes', async () => {
  for (const mutation of ['collision', 'unload']) {
    const f = await fixture(settings());
    f.plugin.saveData = async value => {
      f.plugin.saved = value;
      if (mutation === 'collision') f.entries.set('Tasks/Active/New.md', new TFile('Tasks/Active/New.md', { keep: true }));
      else f.plugin.onunload();
    };
    await assert.rejects(f.plugin.createTask('EXAMPLE', 'New'), /already exists|Settings changed/);
    assert.equal(f.plugin.saved.issueCounters.EXAMPLE, 1);
    if (mutation === 'collision') assert.equal(f.entries.get('Tasks/Active/New.md').fm.keep, true);
    else assert.equal(f.entries.has('Tasks/Active/New.md'), false);
  }
});

test('experimental ordering is opt-in; saves and undo preserve task content and status', async () => {
  const s = settings(); s.cardOrdering.enabled = true;
  const f = await fixture(s); f.ready();
  const fs = ['A', 'B', 'C'].map(name => new TFile('Tasks/Active/' + name + '.md', { project: 'EXAMPLE', type: 'task', status: 'To do', body: 'keep' }));
  fs.forEach(file => f.entries.set(file.path, file));
  const { planOrder } = require('../src/card-order.cjs');
  const plan = planOrder(fs, fs[2], 0, 'ASC', f.plugin.settings, file => file.fm);
  await f.plugin.saveCardOrder(plan);
  assert.deepEqual(fs.map(file => file.fm.order), [2, 3, 1]);
  assert.ok(fs.every(file => file.fm.status === 'To do' && file.fm.body === 'keep'));
  await f.plugin.undoCardOrder();
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
  f.plugin.settings.cardOrdering.enabled = false;
  await f.plugin.saveCardOrder(plan);
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
});

test('native drop handler allows equal leading values and leaves native Sort configuration unchanged', async () => {
  const s = settings(); s.cardOrdering.enabled = true;
  const f = await fixture(s); f.ready();
  const files = ['A', 'B', 'C'].map(name => new TFile('Tasks/Active/' + name + '.md', { project: 'EXAMPLE', type: 'task', status: 'To do', priority: 'High' }));
  files.forEach(file => f.entries.set(file.path, file));
  const group = { entries: files.map(file => ({ file, getValue: property => file.fm[property.replace(/^note\./, '')] ?? null })) };
  const element = {}, column = { group, containerEl: element, innerEl: { getBoundingClientRect: () => ({ top: 100 }) } };
  const sorts = [{ property: 'note.priority', direction: 'ASC' }, { property: 'note.order', direction: 'ASC' }];
  const view = { type: 'kanban', app: f.plugin.app, isReadOnly: false, containerEl: { isConnected: true }, columns: [column],
    config: { groupBy: { property: 'status' }, getSort: () => sorts, getLimit: () => 0 },
    measurements: { cardHeight: 80, cardGap: 20 }, queryController: { getSearchQuery: () => '' } };
  f.plugin.app.dragManager = { draggable: { type: 'kanban-card', view, sourceGroup: group, entry: group.entries[2] } };
  let prevented = false;
  const event = { target: { closest: () => element }, clientY: 100, preventDefault: () => { prevented = true; }, stopPropagation() {} };
  const before = JSON.stringify(sorts);
  f.plugin.onCardOrderEvent(event, true);
  while (f.plugin.orderBusy) await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(files.map(file => file.fm.order), [2, 3, 1]);
  assert.ok(files.every(file => file.fm.priority === 'High'));
  assert.equal(JSON.stringify(sorts), before);
  files[0].fm.priority = 'Low';
  group.entries = [group.entries[2], group.entries[1], group.entries[0]];
  f.plugin.app.dragManager.draggable.entry = group.entries[2];
  const ranks = files.map(file => file.fm.order);
  f.plugin.onCardOrderEvent(event, true);
  assert.deepEqual(files.map(file => file.fm.order), ranks);
  assert.match(f.notices.at(-1), /same leading sort/);
});

test('explicit Base application changes only the selected Base and cancels stale settings', async () => {
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['High', 'Medium', 'Low'] }];
  const f = await fixture(s); f.ready();
  const board = new TFile('Boards/EXAMPLE.base');
  board.content = JSON.stringify({ views: [{ type: 'kanban', sort: [{ property: 'priority', direction: 'ASC' }, { property: 'order', direction: 'ASC' }] }] });
  f.entries.set(board.path, board);
  const note = new TFile('Tasks/Active/A.md', { project: 'EXAMPLE', type: 'task', status: 'To do', priority: 'Low' });
  f.entries.set(note.path, note);
  const captured = f.plugin.settings;
  await f.plugin.applyBaseValueSorts(board, captured);
  assert.ok(JSON.parse(board.content).views[0].sort[0].property.startsWith('formula.bkc_values_'));
  assert.equal(note.fm.priority, 'Low'); assert.equal(note.fm.order, undefined);
  const before = board.content;
  await f.plugin.applyBaseValueSorts(board, captured);
  assert.equal(board.content, before);
  f.plugin.settings = settings();
  await assert.rejects(f.plugin.applyBaseValueSorts(board, captured), /changed/);
  await assert.rejects(f.plugin.applyBaseValueSorts(note, f.plugin.settings), /Base/);
});

test('task creation can select configured text values without introducing rank properties', async () => {
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['High', 'Medium', 'Low'] }];
  const f = await fixture(s); f.ready();
  const note = await f.plugin.createTask('EXAMPLE', 'With priority', { priority: 'Low' });
  assert.ok(note.content.includes('priority: "Low"'));
  assert.ok(!note.content.includes('order:'));
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'Invalid', { priority: 'other' }), /value/);
  await assert.rejects(f.plugin.createTask('EXAMPLE', 'Protected', { status: 'Done' }), /value/);
});

test('settings show automatic Sort-menu and order guidance instead of an editable Description field', async () => {
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['High', 'Medium', 'Low'] }];
  const f = await fixture(s); f.ready(); f.tabs[0].display();
  const label = f.fields.find(field => field.name === 'Sort option name');
  const help = f.fields.find(field => field.name === 'Description');
  const preview = f.fields.find(field => field.name === 'Sort rule preview');
  label.controls[0].change('Important first');
  assert.equal(help, undefined);
  assert.equal(preview.name, 'Important first');
  assert.match(preview.description, /Important first/);
  assert.match(preview.description, /Kanban Sort menu/);
  assert.match(preview.description, /then add order \(ascending\) below/);
  assert.match(preview.description, /High → Medium → Low/);
  assert.equal(f.plugin.settings.valueSorts[0].displayName, '');
  const save = f.fields.flatMap(field => field.controls).find(c => c.text === 'Save');
  await save.click();
  assert.equal(f.plugin.settings.valueSorts[0].displayName, 'Important first');
  assert.equal(Object.hasOwn(f.plugin.settings.valueSorts[0], 'description'), false);
  assert.equal(f.plugin.settings.valueSorts[0].property, 'priority');
  assert.equal(f.entries.size, 0);
});
