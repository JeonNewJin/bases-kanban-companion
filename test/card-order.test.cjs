const test = require('node:test');
const assert = require('node:assert/strict');
const { reorder, planOrder, applyOrder, orderingContext, dropSlot } = require('../src/card-order.cjs');
const { DEFAULT_SETTINGS, validateSettings } = require('../src/core.cjs');

const settings = () => validateSettings({ ...DEFAULT_SETTINGS, cardOrdering: { enabled: true, property: 'order' }, projects: [
  { name: 'EXAMPLE', enabled: true, newTaskFolder: 'Tasks/Active', routes: [{ status: 'To do', folder: 'Tasks/Active' }] }
] });
const files = () => ['A', 'B', 'C'].map(name => ({ path: 'Tasks/Active/' + name + '.md', extension: 'md', parent: { path: 'Tasks/Active' },
  fm: { project: 'EXAMPLE', type: 'task', status: 'To do' } }));
const metadata = file => file.fm;

test('reorder uses insertion boundaries, not rendered-card indices', () => {
  assert.deepEqual(reorder(['A', 'B', 'C'], 'C', 0), ['C', 'A', 'B']);
  assert.deepEqual(reorder(['A', 'B', 'C'], 'A', 3), ['B', 'C', 'A']);
  assert.deepEqual(reorder(['A', 'B', 'C'], 'B', 1), ['A', 'B', 'C']);
  assert.deepEqual(reorder(['A', 'B', 'C'], 'B', 2), ['A', 'B', 'C']);
  assert.throws(() => reorder(['A', 'B'], 'missing', 0));
  assert.throws(() => reorder(['A', 'A'], 'A', 0));
});

test('drop coordinates account for virtualized cards and clamp to column boundaries', () => {
  assert.equal(dropSlot(500, 100, 80, 20, 10), 4);
  assert.equal(dropSlot(-10, 100, 80, 20, 10), 0);
  assert.equal(dropSlot(9999, 100, 80, 20, 10), 10);
  assert.throws(() => dropSlot(100, 0, 0, 0, 3));
});

test('a drop initializes missing numeric ranks, but an already-numbered no-op stays read-only', () => {
  const fs = files(), s = settings();
  assert.deepEqual(planOrder(fs, fs[1], 1, 'ASC', s, metadata).changes.map(change => change.after), [1, 2, 3]);
  const plan = planOrder(fs, fs[2], 0, 'ASC', s, metadata);
  assert.deepEqual(plan.changes.map(change => [change.file.path, change.after]), [
    [fs[2].path, 1], [fs[0].path, 2], [fs[1].path, 3]
  ]);
  assert.deepEqual(fs.map(file => file.fm.order), [undefined, undefined, undefined]);
  fs.forEach((file, index) => { file.fm.order = index + 1; });
  assert.equal(planOrder(fs, fs[1], 1, 'ASC', s, metadata), null);
  assert.throws(() => planOrder(fs, fs[2], 0, 'DESC', s, metadata), /ascending/i);
});

test('a same-position drop fixes a single-card column and can be undone', async () => {
  const fs = files().slice(0, 1); fs[0].fm.priority = 'High'; fs[0].fm.order = 9;
  const plan = planOrder(fs, fs[0], 0, 'ASC', settings(), metadata, leadingOptions(['priority']));
  const undo = await applyOrder(plan, ioFor(fs), () => true);
  assert.equal(fs[0].fm.order, 1);
  assert.equal(fs[0].fm.priority, 'High');
  await applyOrder(undo, ioFor(fs), () => true);
  assert.equal(fs[0].fm.order, 9);
});

test('planning rejects mixed projects, unmanaged notes, excluded folders, and non-numeric ranks', () => {
  for (const mutate of [fs => { fs[0].fm.project = 'Other'; },
    fs => { fs[0].parent.path = 'Elsewhere'; }, fs => { fs[0].fm.order = 'first'; }, fs => { fs[0].fm.order = null; },
    fs => { fs[0].fm.status = 'Unknown'; }, fs => { fs[0].extension = 'png'; }]) {
    const fs = files(); mutate(fs);
    assert.throws(() => planOrder(fs, fs[2], 0, 'ASC', settings(), metadata));
  }
  const s = settings(); s.excludedFolders = ['Tasks'];
  assert.throws(() => planOrder(files(), files()[0], 0, 'ASC', s, metadata));
});

test('ordering accepts mixed or absent type values and never rewrites them', async () => {
  const fs = files(); fs[0].fm.type = 'feature'; fs[1].fm.type = 'bug'; delete fs[2].fm.type;
  const plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
  await applyOrder(plan, ioFor(fs), () => true);
  assert.equal(fs[0].fm.type, 'feature'); assert.equal(fs[1].fm.type, 'bug'); assert.equal('type' in fs[2].fm, false);
});

function ioFor(fs, overrides = {}) {
  return { read: async file => ({ ...file.fm }), process: async (file, callback) => {
    const fm = { ...file.fm }; callback(fm); file.fm = fm;
  }, currentFile: file => fs.includes(file), ...overrides };
}

function leadingOptions(keys) {
  return { guardProperties: keys, sameGroup: (a, b) => keys.every(key => (a.fm[key] ?? '') === (b.fm[key] ?? '')) };
}

test('apply writes ranks only and its returned plan can restore absent properties', async () => {
  const fs = files(), s = settings(), plan = planOrder(fs, fs[2], 0, 'ASC', s, metadata);
  const io = ioFor(fs);
  const undo = await applyOrder(plan, io, () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [2, 3, 1]);
  assert.equal(fs[0].fm.status, 'To do');
  await applyOrder(undo, io, () => true);
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
});

test('stale rank or status is rejected before any write', async () => {
  for (const key of ['order', 'status']) {
    const fs = files(), plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
    fs[0].fm[key] = key === 'order' ? 100 : 'Doing';
    await assert.rejects(applyOrder(plan, ioFor(fs), () => true), /changed/);
    assert.equal(fs[2].fm.order, undefined);
  }
});

test('mid-save failure rolls back already-written ranks without touching other properties', async () => {
  const fs = files(), plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
  let count = 0;
  const io = ioFor(fs, { process: async (file, callback) => {
    if (++count === 2) throw new Error('disk failure');
    const fm = { ...file.fm, description: 'keep' }; callback(fm); file.fm = fm;
  } });
  await assert.rejects(applyOrder(plan, io, () => true), /disk failure/);
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
  assert.equal(fs[2].fm.description, 'keep');
});

test('unload or settings changes during a save abort and restore completed writes', async () => {
  const fs = files(), plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
  let active = true;
  const io = ioFor(fs, { process: async (file, callback) => {
    const fm = { ...file.fm }; callback(fm); file.fm = fm; active = false;
  } });
  await assert.rejects(applyOrder(plan, io, () => active), /disabled|changed/);
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
});

test('rollback never overwrites a concurrent rank edit and reports incomplete recovery', async () => {
  const fs = files(), plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
  let count = 0;
  const io = ioFor(fs, { process: async (file, callback) => {
    if (++count === 2) { fs[2].fm.order = 99; throw new Error('failure'); }
    const fm = { ...file.fm }; callback(fm); file.fm = fm;
  } });
  await assert.rejects(applyOrder(plan, io, () => true), /recovery incomplete/);
  assert.equal(fs[2].fm.order, 99);
});

test('native adapter accepts multiple sorts, but fails closed for other versions, cross-column drops, and searches', () => {
  const fs = files(), s = settings(), element = {}, innerEl = {}, group = { entries: fs.map(file => ({ file })) };
  const column = { containerEl: element, innerEl, group };
  const app = {};
  const view = { type: 'kanban', app, isReadOnly: false, config: { groupBy: { property: 'note.status' }, getSort: () => [{ property: 'note.order', direction: 'ASC' }], getLimit: () => 0 },
    queryController: { getSearchQuery: () => '' }, columns: [column], measurements: { cardHeight: 80, cardGap: 12 } };
  const drag = { type: 'kanban-card', view, entry: group.entries[2], sourceGroup: group };
  const target = { closest: selector => selector === '.bases-kanban-column' ? element : null };
  assert.ok(orderingContext(app, s, '1.14.4', drag, target));
  assert.equal(orderingContext(app, s, '1.14.5', drag, target), null);
  assert.equal(orderingContext(app, s, '1.14.4', { ...drag, sourceGroup: {} }, target), null);
  view.config.getSort = () => [{ property: 'note.order', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }];
  assert.ok(orderingContext(app, s, '1.14.4', drag, target));
  view.config.getSort = () => [{ property: 'note.order', direction: 'ASC' }];
  view.queryController.getSearchQuery = () => 'A';
  assert.equal(orderingContext(app, s, '1.14.4', drag, target), null);
});

test('priority sorting moves only equal-priority cards and numbers the full displayed column from one', async () => {
  const fs = files(); fs.push({ ...fs[0], path: 'Tasks/Active/D.md', fm: { ...fs[0].fm } });
  fs.forEach((file, index) => { file.fm.order = index + 1; file.fm.priority = index % 2 ? 'Low' : 'High'; });
  const displayed = [fs[0], fs[2], fs[1], fs[3]];
  const mode = leadingOptions(['priority']);
  assert.throws(() => planOrder(displayed, fs[2], 3, 'ASC', settings(), metadata, mode), /same leading sort/);
  const before = fs.map(file => file.fm.priority);
  const plan = planOrder(displayed, fs[2], 0, 'ASC', settings(), metadata, mode);
  const undo = await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [2, 3, 1, 4]);
  assert.deepEqual(fs.map(file => file.fm.priority), before);
  assert.deepEqual(fs.slice().sort((a, b) => a.fm.order - b.fm.order).map(file => file.path), [fs[2].path, fs[0].path, fs[1].path, fs[3].path]);
  await applyOrder(undo, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [1, 2, 3, 4]);
});

test('priority-free cards form one reorderable bucket; missing order is initialized without adding priority', async () => {
  const fs = files(); fs[0].fm.priority = 'High'; fs[1].fm.priority = null;
  const plan = planOrder(fs, fs[2], 1, 'ASC', settings(), metadata, leadingOptions(['priority']));
  assert.throws(() => planOrder(fs, fs[2], 0, 'ASC', settings(), metadata, leadingOptions(['priority'])), /same leading sort/);
  await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [1, 3, 2]);
  assert.equal(fs[1].fm.priority, null);
  assert.equal(Object.hasOwn(fs[2].fm, 'priority'), false);
});

test('priority changes while saving or before undo cancel without rewriting priority', async () => {
  const fs = files(); fs.forEach(file => { file.fm.priority = 'High'; });
  const plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata, leadingOptions(['priority']));
  fs[0].fm.priority = 'Low';
  await assert.rejects(applyOrder(plan, ioFor(fs), () => true), /changed/);
  assert.ok(fs.every(file => !Object.hasOwn(file.fm, 'order')));
  fs[0].fm.priority = 'High';
  const undo = await applyOrder(plan, ioFor(fs), () => true);
  fs[0].fm.priority = 'Low';
  await assert.rejects(applyOrder(undo, ioFor(fs), () => true), /changed/);
  assert.equal(fs[0].fm.priority, 'Low');
});

test('manual mode allows different priorities to cross and never rewrites their values', async () => {
  const fs = files(); fs.forEach((file, index) => { file.fm.priority = index === 2 ? 'Low' : 'High'; });
  const plan = planOrder(fs, fs[2], 0, 'ASC', settings(), metadata);
  await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.priority), ['High', 'High', 'Low']);
  assert.deepEqual(fs.map(file => file.fm.order), [2, 3, 1]);
});

test('descending order is rejected without changing ranks or the official sort configuration', () => {
  const fs = files(); fs.push({ ...fs[0], path: 'Tasks/Active/D.md', fm: { ...fs[0].fm } });
  fs.forEach((file, index) => { file.fm.order = 4 - index; file.fm.priority = index % 2 ? 'Low' : 'High'; });
  const before = JSON.stringify(fs);
  assert.throws(() => planOrder([fs[0], fs[2], fs[1], fs[3]], fs[2], 0, 'DESC', settings(), metadata, leadingOptions(['priority'])), /ascending/i);
  assert.equal(JSON.stringify(fs), before);
});

test('moving a lower-priority card also numbers untouched higher-priority cards from one', async () => {
  const fs = files();
  fs.forEach((file, index) => { file.fm.priority = index ? 'Low' : 'High'; file.fm.order = [90, 1, 4][index]; });
  const before = fs.map(file => ({ ...file.fm }));
  const plan = planOrder(fs, fs[2], 1, 'ASC', settings(), metadata, leadingOptions(['priority']));
  const undo = await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [1, 3, 2]);
  assert.deepEqual(fs.map(file => file.fm.priority), ['High', 'Low', 'Low']);
  await applyOrder(undo, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm), before);
});

test('all properties before order constrain a drop; properties after it do not', async () => {
  const fs = files(); fs.forEach(file => { file.fm.priority = 'High'; });
  fs[0].fm.assignee = 'Alex'; fs[1].fm.assignee = 'Blair'; fs[2].fm.assignee = 'Blair';
  const leading = leadingOptions(['priority', 'assignee']);
  assert.throws(() => planOrder(fs, fs[2], 0, 'ASC', settings(), metadata, leading), /same leading sort/);
  const plan = planOrder(fs, fs[2], 1, 'ASC', settings(), metadata, leading);
  await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [1, 3, 2]);
  assert.deepEqual(fs.map(file => file.fm.assignee), ['Alex', 'Blair', 'Blair']);
});

test('native adapter reads the order position without changing the configured sort list', () => {
  const fs = files(); fs.forEach(file => { file.fm.priority = 'High'; });
  const s = settings(), element = {}, group = { entries: fs.map(file => ({ file, getValue: property => file.fm[property.replace(/^note\./, '')] ?? null })) };
  const sort = [{ property: 'note.priority', direction: 'DESC' }, { property: 'note.order', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }];
  const view = { type: 'kanban', app: {}, isReadOnly: false, config: { groupBy: { property: 'status' }, getSort: () => sort, getLimit: () => 0 },
    columns: [{ containerEl: element, innerEl: {}, group }], measurements: { cardHeight: 80, cardGap: 12 }, queryController: { getSearchQuery: () => '' } };
  const drag = { type: 'kanban-card', view, entry: group.entries[2], sourceGroup: group }, target = { closest: () => element };
  const native = { parsePropertyId: id => ({ type: id.split('.')[0], name: id.split('.')[1] }), equalValues: (a, b) => a === b };
  const before = JSON.stringify(sort);
  const context = orderingContext(view.app, s, '1.14.4', drag, target, native);
  assert.equal(context.direction, 'ASC');
  assert.equal(context.constraints.sameGroup(fs[0], fs[2]), true);
  assert.deepEqual(context.constraints.guardProperties, ['priority']);
  assert.equal(context.constraints.unchanged(), true);
  fs[0].fm.priority = 'Low';
  assert.equal(context.constraints.unchanged(), false);
  assert.equal(JSON.stringify(sort), before);
  sort.splice(0, sort.length, { property: 'note.priority', direction: 'ASC' });
  assert.equal(orderingContext(view.app, s, '1.14.4', drag, target, native), null);
});

test('managed value formulas allow Korean ties, block cross-value drops, and guard formula/source edits', async () => {
  const { formulaName, formulaText } = require('../src/value-sort.cjs');
  const s = settings(); s.valueSorts = [{ property: 'priority', values: ['High', 'Medium', 'Low'] }];
  const rule = s.valueSorts[0], name = formulaName('priority');
  const fs = files(); fs[0].fm.priority = 'High'; fs[1].fm.priority = 'Low'; fs[2].fm.priority = 'Low';
  const element = {}, group = { entries: fs.map(file => ({ file, getValue: id => file.fm[id.replace(/^note\./, '')] ?? null })) };
  const sort = [{ property: 'formula.' + name, direction: 'ASC' }, { property: 'priority', direction: 'ASC' }, { property: 'order', direction: 'ASC' }];
  const view = { type: 'kanban', app: {}, isReadOnly: false, config: { query: { formulas: { [name]: { toString: () => formulaText(rule) } } },
    groupBy: { property: 'status' }, getSort: () => sort, getLimit: () => 0 }, columns: [{ containerEl: element, innerEl: {}, group }],
    measurements: { cardHeight: 80, cardGap: 12 }, queryController: { getSearchQuery: () => '' } };
  const drag = { type: 'kanban-card', view, entry: group.entries[2], sourceGroup: group }, target = { closest: () => element };
  const native = { parsePropertyId: id => id.includes('.') ? { type: id.split('.')[0], name: id.split('.').slice(1).join('.') } : { type: 'note', name: id }, equalValues: (a, b) => a === b };
  const context = orderingContext(view.app, s, '1.14.4', drag, target, native);
  assert.deepEqual(context.constraints.guardProperties, ['priority']);
  assert.throws(() => planOrder(fs, fs[2], 0, 'ASC', s, metadata, context.constraints), /same leading/);
  const plan = planOrder(fs, fs[2], 1, 'ASC', s, metadata, context.constraints);
  const undo = await applyOrder(plan, ioFor(fs), () => true);
  assert.deepEqual(fs.map(file => file.fm.order), [1, 3, 2]);
  assert.deepEqual(fs.map(file => file.fm.priority), ['High', 'Low', 'Low']);
  view.config.query.formulas[name] = { toString: () => 'note.order' };
  assert.equal(context.constraints.unchanged(), false);
  await assert.rejects(applyOrder(undo, ioFor(fs), () => true), /changed/);
  assert.throws(() => orderingContext(view.app, s, '1.14.4', drag, target, native), /arbitrary|outdated/);
});
