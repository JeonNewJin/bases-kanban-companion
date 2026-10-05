const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, validateSettings } = require('../src/core.cjs');

class TFolder { constructor(path) { this.path = path; } }
class TFile {
  constructor(path, fm = {}) { this.path = path; this.name = path.split('/').pop(); this.extension = 'md'; this.parent = new TFolder(path.slice(0, path.lastIndexOf('/'))); this.fm = fm; }
}
async function fixture(saved = null) {
  const notices = [], commands = [], events = {}, entries = new Map();
  let ready;
  class Plugin {
    async loadData() { return saved; }
    async saveData(value) { this.saved = value; }
    addSettingTab() {}
    registerEvent() {}
    addCommand(command) { commands.push(command); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), {
    module, console,
    require: name => name === 'obsidian' ? {
      Plugin, TFile, TFolder, PluginSettingTab: class {}, FuzzySuggestModal: class {}, Modal: class {},
      Notice: class { constructor(text) { notices.push(text); } },
      stringifyYaml: fm => Object.entries(fm).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n'
    } : require(path.join(__dirname, '../src', name))
  });
  const plugin = new module.exports();
  plugin.app = {
    vault: {
      on: (event, callback) => { events[event] = callback; },
      getAbstractFileByPath: path => entries.get(path),
      getMarkdownFiles: () => [...entries.values()].filter(file => file instanceof TFile),
      createFolder: async path => entries.set(path, new TFolder(path)),
      create: async (path, content) => { assert.equal(entries.has(path), false); const file = new TFile(path); file.content = content; entries.set(path, file); return file; }
    },
    metadataCache: { on: (event, callback) => { events[event] = callback; }, getFileCache: file => ({ frontmatter: file.fm }) },
    workspace: { onLayoutReady: callback => { ready = callback; } },
    fileManager: { renameFile: async (file, target) => {
      assert.equal(entries.has(target), false); entries.delete(file.path); file.path = target;
      file.parent = entries.get(target.slice(0, target.lastIndexOf('/'))); entries.set(target, file);
    } }
  };
  await plugin.onload();
  return { plugin, notices, commands, events, entries, ready: () => ready() };
}
const settings = () => validateSettings({ ...DEFAULT_SETTINGS, projects: [{ name: 'Example', enabled: true, newTaskFolder: 'Tasks/Active',
  routes: [{ status: 'To do', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }] }] });

test('loading is read-only and registers commands; fresh installs have no rules', async () => {
  const f = await fixture();
  assert.equal(f.plugin.settings.projects.length, 0); assert.equal(f.plugin.saved, undefined);
  assert.deepEqual(f.commands.map(command => command.id), ['review-pending-moves', 'create-project-task']);
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
