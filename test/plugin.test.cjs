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
  const notices = [], commands = [], events = {}, entries = new Map(), tabs = [], fields = [];
  const container = { empty() { fields.length = 0; }, addClass() {}, createEl() {} };
  const control = () => ({ inputEl: { setAttribute() {}, addClass() {} }, setValue(value) { this.value = value; return this; },
    setPlaceholder() { return this; }, onChange(callback) { this.change = callback; return this; },
    setButtonText(text) { this.text = text; return this; }, setCta() { return this; }, setDisabled() { return this; },
    onClick(callback) { this.click = callback; return this; }, addOption() { return this; } });
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
      Plugin, TFile, TFolder, Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = container; } }, FuzzySuggestModal: class {}, Modal: class {},
      Notice: class { constructor(text) { notices.push(text); } },
      apiVersion: '1.14.4',
      getFrontMatterInfo: text => ({ exists: true, frontmatter: text }),
      parseYaml: JSON.parse,
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
      getMarkdownFiles: () => [...entries.values()].filter(file => file instanceof TFile),
      read: async file => file.content ?? JSON.stringify(file.fm),
      process: async (file, callback) => { file.content = callback(file.content); },
      createFolder: async path => entries.set(path, new TFolder(path)),
      create: async (path, content) => { assert.equal(entries.has(path), false); const file = new TFile(path); file.content = content; entries.set(path, file); return file; }
    },
    metadataCache: { on: (event, callback) => { events[event] = callback; }, getFileCache: file => ({ frontmatter: file.fm }) },
    workspace: { onLayoutReady: callback => { ready = callback; } },
    fileManager: { processFrontMatter: async (file, callback) => {
      const fm = { ...file.fm }; callback(fm); file.fm = fm;
    }, renameFile: async (file, target) => {
      assert.equal(entries.has(target), false); entries.delete(file.path); file.path = target;
      file.parent = entries.get(target.slice(0, target.lastIndexOf('/'))); entries.set(target, file);
    } }
  };
  await plugin.onload();
  return { plugin, notices, commands, events, entries, tabs, fields, ready: () => ready() };
}
const settings = () => validateSettings({ ...DEFAULT_SETTINGS, projects: [{ name: 'Example', enabled: true, newTaskFolder: 'Tasks/Active',
  routes: [{ status: 'To do', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }] }] });

test('loading is read-only and registers commands; fresh installs have no rules', async () => {
  const f = await fixture();
  assert.equal(f.plugin.settings.projects.length, 0); assert.equal(f.plugin.saved, undefined);
  assert.deepEqual(f.commands.map(command => command.id), ['review-pending-moves', 'create-project-task', 'undo-card-reorder', 'apply-value-sorts']);
  f.commands[1].callback(); assert.match(f.notices[0], /Add and save/);
});

test('startup metadata is ignored, then later edits route; unload blocks events', async () => {
  const f = await fixture(settings());
  const file = new TFile('Tasks/Active/Task.md', { project: 'Example', type: 'task', status: 'Done' });
  f.entries.set(file.path, file);
  f.events.changed(file); await f.plugin.router.queue; assert.equal(file.path, 'Tasks/Active/Task.md');
  f.ready(); assert.equal(file.path, 'Tasks/Active/Task.md');
  f.events.changed(file); await f.plugin.router.queue; assert.equal(file.path, 'Tasks/Archive/Task.md');
  f.plugin.onunload(); file.fm.status = 'To do'; f.events.changed(file); await f.plugin.router.queue;
  assert.equal(file.path, 'Tasks/Archive/Task.md');
});

test('invalid saved configuration is not overwritten and cannot move notes', async () => {
  const f = await fixture({ version: 3, projects: 'corrupt' });
  assert.equal(f.plugin.saved, undefined); assert.equal(f.plugin.settings.projects.length, 0);
  assert.match(f.notices[0], /Routing is disabled/);
});

test('saving validates before persistence and does not scan existing notes', async () => {
  const f = await fixture(settings());
  const file = new TFile('Tasks/Active/Task.md', { project: 'Example', type: 'task', status: 'Done' });
  f.entries.set(file.path, file); f.ready();
  await assert.rejects(f.plugin.updateSettings({ projects: 'invalid' }));
  assert.equal(f.plugin.saved, undefined);
  await f.plugin.updateSettings(settings()); await f.plugin.router.queue;
  assert.equal(file.path, 'Tasks/Active/Task.md'); assert.equal(f.plugin.saved.version, 3);
});

test('creation sets properties, creates parent folders, and rejects duplicate titles', async () => {
  const f = await fixture(settings()); f.ready();
  const note = await f.plugin.createTask('Example', 'A new task');
  assert.equal(note.path, 'Tasks/Active/A new task.md');
  for (const text of ['project: "Example"', 'type: "task"', 'status: "To do"']) assert.ok(note.content.includes(text));
  assert.ok(f.entries.get('Tasks') instanceof TFolder); assert.ok(f.entries.get('Tasks/Active') instanceof TFolder);
  await assert.rejects(f.plugin.createTask('Example', 'A new task'), /already exists/);
  await assert.rejects(f.plugin.createTask('Example', '../escape'));
});

test('changing settings during folder creation cancels task creation', async () => {
  const f = await fixture(settings());
  f.plugin.ensureFolder = async () => { f.plugin.settings = settings(); };
  await assert.rejects(f.plugin.createTask('Example', 'A new task'), /Settings changed/);
  assert.equal(f.entries.size, 0);
});

test('experimental ordering is opt-in; saves and undo preserve task content and status', async () => {
  const s = settings(); s.cardOrdering.enabled = true;
  const f = await fixture(s); f.ready();
  const fs = ['A', 'B', 'C'].map(name => new TFile('Tasks/Active/' + name + '.md', { project: 'Example', type: 'task', status: 'To do', body: 'keep' }));
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
  const files = ['A', 'B', 'C'].map(name => new TFile('Tasks/Active/' + name + '.md', { project: 'Example', type: 'task', status: 'To do', priority: 'High' }));
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
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['높음', '보통', '낮음'] }];
  const f = await fixture(s); f.ready();
  const board = new TFile('Boards/Example.base');
  board.content = JSON.stringify({ views: [{ type: 'kanban', sort: [{ property: 'priority', direction: 'ASC' }, { property: 'order', direction: 'ASC' }] }] });
  f.entries.set(board.path, board);
  const note = new TFile('Tasks/Active/A.md', { project: 'Example', type: 'task', status: 'To do', priority: '낮음' });
  f.entries.set(note.path, note);
  const captured = f.plugin.settings;
  await f.plugin.applyBaseValueSorts(board, captured);
  assert.ok(JSON.parse(board.content).views[0].sort[0].property.startsWith('formula.bkc_values_'));
  assert.equal(note.fm.priority, '낮음'); assert.equal(note.fm.order, undefined);
  const before = board.content;
  await f.plugin.applyBaseValueSorts(board, captured);
  assert.equal(board.content, before);
  f.plugin.settings = settings();
  await assert.rejects(f.plugin.applyBaseValueSorts(board, captured), /changed/);
  await assert.rejects(f.plugin.applyBaseValueSorts(note, f.plugin.settings), /Base/);
});

test('task creation can select configured text values without introducing rank properties', async () => {
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['높음', '보통', '낮음'] }];
  const f = await fixture(s); f.ready();
  const note = await f.plugin.createTask('Example', 'With priority', { priority: '낮음' });
  assert.ok(note.content.includes('priority: "낮음"'));
  assert.ok(!note.content.includes('order:'));
  await assert.rejects(f.plugin.createTask('Example', 'Invalid', { priority: 'other' }), /value/);
  await assert.rejects(f.plugin.createTask('Example', 'Protected', { status: 'Done' }), /value/);
});

test('settings show automatic Sort-menu and order guidance instead of an editable Description field', async () => {
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['높음', '보통', '낮음'] }];
  const f = await fixture(s); f.ready(); f.tabs[0].display();
  const label = f.fields.find(field => field.name === 'Sort option name');
  const help = f.fields.find(field => field.name === 'Description');
  const preview = f.fields.find(field => field.name === 'Sort rule preview');
  label.controls[0].change('중요한 작업 먼저');
  assert.equal(help, undefined);
  assert.equal(preview.name, '중요한 작업 먼저');
  assert.match(preview.description, /중요한 작업 먼저/);
  assert.match(preview.description, /Kanban Sort menu/);
  assert.match(preview.description, /then add order \(ascending\) below/);
  assert.match(preview.description, /높음 → 보통 → 낮음/);
  assert.equal(f.plugin.settings.valueSorts[0].displayName, '');
  const save = f.fields.flatMap(field => field.controls).find(c => c.text === 'Save');
  await save.click();
  assert.equal(f.plugin.settings.valueSorts[0].displayName, '중요한 작업 먼저');
  assert.equal(Object.hasOwn(f.plugin.settings.valueSorts[0], 'description'), false);
  assert.equal(f.plugin.settings.valueSorts[0].property, 'priority');
  assert.equal(f.entries.size, 0);
});
