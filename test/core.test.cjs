const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, validateSettings, migrateSettings, getDestination, taskFrontmatter, taskPath } = require('../src/core.cjs');

const project = () => ({ name: 'EXAMPLE', enabled: true, newTaskFolder: 'Tasks/Active', routes: [
  { status: 'To do', folder: 'Tasks/Active' }, { status: 'Doing', folder: 'Tasks/Active' },
  { status: 'Review', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }
] });
const configured = (changes = {}) => validateSettings({ ...DEFAULT_SETTINGS, projects: [project()], ...changes });
const task = (status = 'Done') => ({ project: 'EXAMPLE', type: 'task', status });

test('compact card sizing is opt-in, migrated and validated independently of ordering', () => {
  assert.deepEqual(DEFAULT_SETTINGS.compactCards, { enabled: false, minColumnWidth: 5 });
  assert.deepEqual(migrateSettings({ version: 3, projects: [] }).compactCards, { enabled: false, minColumnWidth: 5 });
  assert.deepEqual(configured({ compactCards: { enabled: true } }).compactCards, { enabled: true, minColumnWidth: 5 });
  assert.deepEqual(configured({ compactCards: { enabled: true, minColumnWidth: 3.5 } }).compactCards, { enabled: true, minColumnWidth: 3.5 });
  for (const compactCards of [null, [], true, {}, { enabled: 'true' }, { enabled: true, minColumnWidth: 2.5 }, { enabled: true, minColumnWidth: 10.5 }, { enabled: true, minColumnWidth: 4.2 }, { enabled: true, minColumnWidth: '5' }, { enabled: true, minColumnWidth: NaN }]) {
    assert.throws(() => configured({ compactCards }), /card.*layout/i);
  }
});

test('a fresh install has no projects and cannot route existing notes', () => {
  assert.deepEqual(DEFAULT_SETTINGS.projects, []);
  assert.equal(getDestination('Tasks/Active', task(), DEFAULT_SETTINGS), null);
  assert.deepEqual(migrateSettings(null), DEFAULT_SETTINGS);
});

test('four statuses may share two folders; only exact matching tasks are eligible', () => {
  const settings = configured();
  assert.equal(getDestination('Tasks/Active', task(), settings), 'Tasks/Archive');
  for (const status of ['To do', 'Doing', 'Review']) {
    assert.equal(getDestination('Tasks/Archive', task(status), settings), 'Tasks/Active');
  }
  for (const fm of [null, {}, { ...task(), project: 'Other' }, task('Unknown')]) {
    assert.equal(getDestination('Tasks/Active', fm, settings), null);
  }
  for (const folder of ['Elsewhere', 'Tasks/Active/Subfolder', '.obsidian']) {
    assert.equal(getDestination(folder, task(), settings), null);
  }
});

test('property names and exclusions are configurable; type is no longer a routing or creation requirement', () => {
  const settings = configured({ properties: { project: 'board', type: 'kind', status: 'stage', taskType: 'ticket' }, excludedFolders: ['Tasks/Archive'] });
  assert.equal(getDestination('Tasks/Active', { board: 'EXAMPLE', kind: 'ticket', stage: 'Done' }, settings), null);
  assert.equal(getDestination('Tasks/Active', task(), settings), null);
  assert.deepEqual(taskFrontmatter('EXAMPLE', settings), { board: 'EXAMPLE', stage: 'To do' });
  assert.deepEqual(settings.properties, { project: 'board', status: 'stage' });
  const migrated = migrateSettings({ ...settings, properties: { ...settings.properties, type: 'kind', taskType: 'ticket' } });
  assert.deepEqual(migrated.properties, { project: 'board', status: 'stage' });
  assert.equal(getDestination('Tasks/Active', { board: 'EXAMPLE', stage: 'Review' }, migrated), 'Tasks/Active');
  const unrestricted = configured({ properties: { ...DEFAULT_SETTINGS.properties, taskType: '' } });
  assert.equal(getDestination('Tasks/Active', { project: 'EXAMPLE', status: 'Done' }, unrestricted), 'Tasks/Archive');
  assert.deepEqual(taskFrontmatter('EXAMPLE', unrestricted), { project: 'EXAMPLE', status: 'To do' });
  for (const type of [undefined, 'feature', 'bug', 'project']) {
    assert.equal(getDestination('Tasks/Active', { project: 'EXAMPLE', type, status: 'Done' }, configured()), 'Tasks/Archive');
  }
});

test('disabled projects and excluded descendants never move', () => {
  const settings = configured({ projects: [{ ...project(), enabled: false }] });
  assert.equal(getDestination('Tasks/Active', task(), settings), null);
  const excluded = configured({ excludedFolders: ['Tasks'] });
  assert.equal(getDestination('Tasks/Active', task(), excluded), null);
  assert.throws(() => taskFrontmatter('EXAMPLE', excluded), /excluded/);
});

test('validation rejects duplicate rules, unsafe paths, and unsafe property names', () => {
  assert.throws(() => configured({ projects: [project(), project()] }), /unique/);
  assert.throws(() => configured({ projects: [{ ...project(), routes: [project().routes[0], project().routes[0]] }] }), /unique/);
  for (const folder of ['', '/', '/Users', '../Tasks', 'Tasks/../Other', 'Tasks//Active', 'Tasks\\Active', '.obsidian/plugins', 'Tasks/.hidden']) {
    assert.throws(() => configured({ projects: [{ ...project(), newTaskFolder: folder }] }));
  }
  for (const key of ['__proto__', 'constructor', 'prototype', '', 'line\nbreak']) {
    assert.throws(() => configured({ properties: { ...DEFAULT_SETTINGS.properties, project: key } }));
  }
  assert.throws(() => configured({ properties: { ...DEFAULT_SETTINGS.properties, status: 'project' } }), /distinct/);
  assert.throws(() => migrateSettings({ version: 99, projects: [] }), /version/);
  assert.throws(() => migrateSettings({ version: 3, projects: 'invalid' }));
});

test('legacy v2 import preserves project routes without retaining a type restriction', () => {
  const legacy = { version: 2, projects: [{ ...project(), name: 'Legacy board' }] };
  const migrated = migrateSettings(legacy);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.properties, { project: 'project', status: 'status' });
  assert.deepEqual(migrated.projects, legacy.projects);
  assert.equal(getDestination('Tasks/Active', { project: 'Legacy board', type: 'note', status: 'Done' }, migrated), 'Tasks/Archive');
  assert.equal(getDestination('Tasks/Active', { project: 'Legacy board', status: 'Done' }, migrated), 'Tasks/Archive');
  assert.deepEqual(legacy, { version: 2, projects: [{ ...project(), name: 'Legacy board' }] });
});

test('new tasks use the first route and reject traversal, hidden names, and unknown projects', () => {
  const settings = configured();
  assert.equal(taskPath('EXAMPLE', 'A task.md', settings), 'Tasks/Active/A task.md');
  assert.deepEqual(taskFrontmatter('EXAMPLE', settings), { project: 'EXAMPLE', status: 'To do' });
  for (const title of ['', '../escape', '.hidden', 'bad/name', 'bad:name', 'bad\\name']) {
    assert.throws(() => taskPath('EXAMPLE', title, settings));
  }
  assert.throws(() => taskFrontmatter('Unknown', settings), /enabled project/);
});

test('template folders are optional, validated, and backfilled without changing existing rules', () => {
  const original = configured(); delete original.templates;
  const migrated = migrateSettings(original);
  assert.deepEqual(migrated.templates, { folder: '' });
  assert.deepEqual(migrated.projects, original.projects);
  assert.deepEqual(configured({ templates: { folder: 'Templates/Tasks/' } }).templates, { folder: 'Templates/Tasks' });
  for (const templates of [null, [], { folder: 1 }, { folder: '../Templates' }, { folder: '.obsidian' }]) {
    assert.throws(() => configured({ templates }), /template|folder|path/i);
  }
});

test('new project settings require English letters, normalize case and reject normalized duplicates', () => {
  assert.equal(configured({ projects: [{ ...project(), name: 'example' }] }).projects[0].name, 'EXAMPLE');
  for (const name of ['', 'PROJÉT', 'EXAMPLE1', 'EXAMPLE APP', 'EXAMPLE-App', 'EXAMPLE_']) {
    assert.throws(() => configured({ projects: [{ ...project(), name }] }), /English|project name/i);
  }
  assert.throws(() => configured({ projects: [{ ...project(), name: 'example' }, { ...project(), name: 'EXAMPLE' }] }), /unique/);
  const legacy = { version: 3, projects: [{ ...project(), name: 'Legacy board' }] };
  assert.equal(migrateSettings(legacy).projects[0].name, 'Legacy board');
  assert.throws(() => validateSettings(migrateSettings(legacy)), /English/);
});

test('issue counters backfill, survive project removal and reject malformed data or property collisions', () => {
  assert.deepEqual(migrateSettings({ version: 3, projects: [] }).issueCounters, {});
  assert.deepEqual(configured({ issueCounters: { EXAMPLE: 5, OLD: 2 } }).issueCounters, { EXAMPLE: 5, OLD: 2 });
  for (const issueCounters of [null, [], { EXAMPLE: -1 }, { EXAMPLE: 1.5 }, { EXAMPLE: '2' }, { example: 1 }, { EXAMPLE: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => configured({ issueCounters }), /counter/i);
  }
  for (const key of ['project', 'status']) assert.throws(() => configured({ properties: { ...DEFAULT_SETTINGS.properties, [key]: 'issue_id' } }), /issue_id/);
  assert.throws(() => configured({ cardOrdering: { enabled: false, property: 'issue_id' } }), /issue_id/);
  assert.throws(() => configured({ valueSorts: [{ property: 'issue_id', values: ['A'] }] }), /issue_id/);
});
