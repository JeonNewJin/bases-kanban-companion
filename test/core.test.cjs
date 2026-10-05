const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, validateSettings, migrateSettings, getDestination, taskFrontmatter, taskPath } = require('../src/core.cjs');

const project = () => ({ name: 'EXAMPLE', enabled: true, newTaskFolder: 'Tasks/Active', routes: [
  { status: 'To do', folder: 'Tasks/Active' }, { status: 'Doing', folder: 'Tasks/Active' },
  { status: 'Review', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }
] });
const configured = (changes = {}) => validateSettings({ ...DEFAULT_SETTINGS, projects: [project()], ...changes });
const task = (status = 'Done') => ({ project: 'EXAMPLE', type: 'task', status });

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
  for (const fm of [null, {}, { ...task(), project: 'Other' }, { ...task(), type: 'project' }, task('Unknown')]) {
    assert.equal(getDestination('Tasks/Active', fm, settings), null);
  }
  for (const folder of ['Elsewhere', 'Tasks/Active/Subfolder', '.obsidian']) {
    assert.equal(getDestination(folder, task(), settings), null);
  }
});

test('property names, task type, and exclusions are configurable', () => {
  const settings = configured({ properties: { project: 'board', type: 'kind', status: 'stage', taskType: 'ticket' }, excludedFolders: ['Tasks/Archive'] });
  assert.equal(getDestination('Tasks/Active', { board: 'EXAMPLE', kind: 'ticket', stage: 'Done' }, settings), null);
  assert.equal(getDestination('Tasks/Active', task(), settings), null);
  assert.deepEqual(taskFrontmatter('EXAMPLE', settings), { board: 'EXAMPLE', kind: 'ticket', stage: 'To do' });
  const unrestricted = configured({ properties: { ...DEFAULT_SETTINGS.properties, taskType: '' } });
  assert.equal(getDestination('Tasks/Active', { project: 'EXAMPLE', status: 'Done' }, unrestricted), 'Tasks/Archive');
  assert.deepEqual(taskFrontmatter('EXAMPLE', unrestricted), { project: 'EXAMPLE', status: 'To do' });
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

test('legacy v2 import preserves mappings and the old task-type value without embedding personal defaults', () => {
  const legacy = { version: 2, projects: [{ ...project(), name: 'Legacy board' }] };
  const migrated = migrateSettings(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.properties.taskType, '작업');
  assert.deepEqual(migrated.projects, legacy.projects);
  assert.equal(getDestination('Tasks/Active', { project: 'Legacy board', type: '작업', status: 'Done' }, migrated), 'Tasks/Archive');
  assert.deepEqual(legacy, { version: 2, projects: [{ ...project(), name: 'Legacy board' }] });
});

test('new tasks use the first route and reject traversal, hidden names, and unknown projects', () => {
  const settings = configured();
  assert.equal(taskPath('EXAMPLE', 'A task.md', settings), 'Tasks/Active/A task.md');
  assert.deepEqual(taskFrontmatter('EXAMPLE', settings), task('To do'));
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
  assert.equal(configured({ projects: [{ ...project(), name: 'grid' }] }).projects[0].name, 'GRID');
  for (const name of ['', '그리드', 'GRID1', 'GRID APP', 'GRID-App', 'GRID_']) {
    assert.throws(() => configured({ projects: [{ ...project(), name }] }), /English|project name/i);
  }
  assert.throws(() => configured({ projects: [{ ...project(), name: 'grid' }, { ...project(), name: 'GRID' }] }), /unique/);
  const legacy = { version: 3, projects: [{ ...project(), name: 'Legacy board' }] };
  assert.equal(migrateSettings(legacy).projects[0].name, 'Legacy board');
  assert.throws(() => validateSettings(migrateSettings(legacy)), /English/);
});

test('issue counters backfill, survive project removal and reject malformed data or property collisions', () => {
  assert.deepEqual(migrateSettings({ version: 3, projects: [] }).issueCounters, {});
  assert.deepEqual(configured({ issueCounters: { GRID: 5, OLD: 2 } }).issueCounters, { GRID: 5, OLD: 2 });
  for (const issueCounters of [null, [], { GRID: -1 }, { GRID: 1.5 }, { GRID: '2' }, { grid: 1 }, { GRID: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => configured({ issueCounters }), /counter/i);
  }
  for (const key of ['project', 'status', 'type']) assert.throws(() => configured({ properties: { ...DEFAULT_SETTINGS.properties, [key]: 'issue_id' } }), /issue_id/);
  assert.throws(() => configured({ cardOrdering: { enabled: false, property: 'issue_id' } }), /issue_id/);
  assert.throws(() => configured({ valueSorts: [{ property: 'issue_id', values: ['A'] }] }), /issue_id/);
});
