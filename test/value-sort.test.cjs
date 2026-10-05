const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, validateSettings, migrateSettings } = require('../src/core.cjs');
const { formulaName, formulaText, applyValueSorts, managedSortProperty, sortExplanation } = require('../src/value-sort.cjs');

const rule = () => ({ property: 'priority', values: ['높음', '보통', '낮음'] });
const settings = rules => validateSettings({ ...DEFAULT_SETTINGS, valueSorts: rules });
const base = () => ({ filters: { and: ['note.project == "Example"'] }, properties: { 'note.priority': { displayName: '우선순위' } },
  views: [{ type: 'kanban', name: 'Board', groupBy: { property: 'status', direction: 'ASC' },
    sort: [{ property: 'priority', direction: 'DESC' }, { property: 'order', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }] },
  { type: 'table', name: 'Table', sort: [{ property: 'priority', direction: 'ASC' }] }] });

test('value rules backfill old settings, preserve ordered Korean labels, and reject ambiguous rules', () => {
  assert.deepEqual(migrateSettings({ ...DEFAULT_SETTINGS }).valueSorts, []);
  assert.deepEqual(settings([rule()]).valueSorts, [{ ...rule(), displayName: '' }]);
  for (const rules of [[rule(), rule()], [{ property: 'order', values: ['A'] }], [{ property: 'status', values: ['A'] }],
    [{ property: 'priority', values: [] }], [{ property: 'priority', values: ['A', ' A '] }],
    [{ property: 'priority', values: [''] }], [{ property: 'priority', values: [1] }]]) {
    assert.throws(() => settings(rules));
  }
});

test('display names are validated and legacy editable descriptions are dropped by settings migration', () => {
  const custom = { ...rule(), displayName: '  중요한 작업 먼저  ', description: '높음부터 표시합니다.\r\n같은 값끼리 드래그합니다.' };
  const migrated = migrateSettings({ ...DEFAULT_SETTINGS, valueSorts: [custom] });
  assert.equal(migrated.valueSorts[0].displayName, '중요한 작업 먼저');
  assert.equal(Object.hasOwn(migrated.valueSorts[0], 'description'), false);
  for (const fields of [{ displayName: 1 }, { displayName: 'a\nb' }, { displayName: 'x'.repeat(129) }]) {
    assert.throws(() => settings([{ ...rule(), ...fields }]));
  }
});

test('configured names update the official label without persisting editable help or changing sorting', () => {
  const original = applyValueSorts(base(), settings([rule()])), name = formulaName('priority');
  original.bkcValueSorts[name].description = 'Legacy help';
  const custom = { ...rule(), displayName: '우선순위: 높음 → 보통 → 낮음', description: '중요한 작업부터 표시합니다.' };
  const next = applyValueSorts(original, settings([custom]));
  assert.equal(next.properties['formula.' + name].displayName, custom.displayName);
  assert.equal(Object.hasOwn(next.bkcValueSorts[name], 'description'), false);
  assert.equal(next.bkcValueSorts[name].displayName, custom.displayName);
  assert.equal(next.formulas[name], original.formulas[name]);
  assert.deepEqual(next.views, original.views);
  assert.deepEqual(next.properties['note.priority'], original.properties['note.priority']);
  assert.deepEqual(applyValueSorts(next, settings([custom])), next);
  assert.match(sortExplanation(custom, 'rank'), /높음 → 보통 → 낮음/);
  assert.match(sortExplanation(custom, 'rank'), /rank/);
  assert.match(sortExplanation(custom, 'rank'), /Kanban Sort menu/);
  assert.match(sortExplanation(custom, 'rank'), /then add rank \(ascending\) below/);
  assert.ok(sortExplanation(custom, 'rank').includes(custom.displayName));
  assert.ok(!sortExplanation(custom, 'rank').includes(custom.description));
});

test('updating labels on a formula-and-order board does not restore a deliberately removed text sort', () => {
  const initial = applyValueSorts(base(), settings([rule()]));
  initial.views[0].sort = initial.views[0].sort.filter(row => row.property !== 'priority');
  const next = applyValueSorts(initial, settings([{ ...rule(), displayName: '높음 먼저', description: '도움말' }]));
  assert.deepEqual(next.views[0].sort, initial.views[0].sort);
});

test('generated formulas encode labels and property names as string literals with an unknown-value fallback', () => {
  assert.equal(formulaText(rule()), 'if(note["priority"] == "높음", 1, if(note["priority"] == "보통", 2, if(note["priority"] == "낮음", 3, 4)))');
  const odd = { property: 'a"b', values: ['a"b', 'x\\y'] };
  assert.ok(formulaText(odd).includes(JSON.stringify(odd.property)));
  assert.ok(formulaText(odd).includes(JSON.stringify(odd.values[1])));
  assert.notEqual(formulaName('a-b'), formulaName('a_b'));
});

test('explicit Base setup keeps filters, displayed properties, table views and unrelated sorts intact', () => {
  const original = base(), before = JSON.stringify(original), s = settings([rule()]);
  const result = applyValueSorts(original, s);
  const name = formulaName('priority');
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(result.filters, original.filters);
  assert.deepEqual(result.views[1], original.views[1]);
  assert.deepEqual(result.views[0].sort, [{ property: 'formula.' + name, direction: 'ASC' },
    { property: 'priority', direction: 'DESC' }, { property: 'order', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }]);
  assert.equal(result.formulas[name], formulaText(rule()));
  assert.equal(result.properties['formula.' + name].displayName, '우선순위 정렬 순서');
  assert.deepEqual(applyValueSorts(result, s), result);
});

test('reapplication renames the old generated label without replacing a custom display name', () => {
  const s = settings([rule()]), initial = applyValueSorts(base(), s), id = 'formula.' + formulaName('priority');
  initial.properties[id].displayName = '우선순위 · 값 순서';
  assert.equal(applyValueSorts(initial, s).properties[id].displayName, '우선순위 정렬 순서');
  initial.properties[id].displayName = 'My custom label';
  assert.equal(applyValueSorts(initial, s).properties[id].displayName, 'My custom label');
});

test('reapplying updates owned formulas, preserves native sort precedence and never overwrites edited formulas', () => {
  const initial = applyValueSorts(base(), settings([rule()])), name = formulaName('priority');
  initial.views[0].sort[0].direction = 'DESC';
  const updated = applyValueSorts(initial, settings([{ ...rule(), values: ['낮음', '높음', '보통'] }]));
  assert.equal(updated.views[0].sort[0].direction, 'DESC');
  assert.notEqual(updated.formulas[name], initial.formulas[name]);
  const reordered = JSON.parse(JSON.stringify(updated));
  reordered.views[0].sort.unshift(reordered.views[0].sort.splice(2, 1)[0]);
  reordered.views[0].sort.unshift(reordered.views[0].sort.splice(2, 1)[0]);
  const reapplied = applyValueSorts(reordered, settings([rule()]));
  assert.deepEqual(reapplied.views[0].sort, reordered.views[0].sort);
  assert.equal(reapplied.views[0].sort.filter(row => row.property === 'formula.' + name).length, 1);
  initial.formulas[name] = 'note.order';
  assert.throws(() => applyValueSorts(initial, settings([rule()])), /edited|collision/i);
});

test('only exact generated formulas for saved rules qualify for the safe drag adapter', () => {
  const s = settings([rule()]), name = formulaName('priority');
  const config = { query: { formulas: { [name]: { toString: () => formulaText(rule()) } } } };
  assert.equal(managedSortProperty(name, config, s), 'priority');
  config.query.formulas[name] = { toString: () => 'note.order' };
  assert.equal(managedSortProperty(name, config, s), null);
  assert.equal(managedSortProperty('other', config, s), null);
});

test('setup refuses unrelated boards, incomplete manual sorts, unsafe formula collisions and malformed Base data', () => {
  const s = settings([rule()]);
  const unrelated = base(); unrelated.views[0].sort = [{ property: 'order', direction: 'ASC' }];
  assert.throws(() => applyValueSorts(unrelated, s), /matching/i);
  const missingOrder = base(); missingOrder.views[0].sort.pop(); missingOrder.views[0].sort.pop();
  assert.throws(() => applyValueSorts(missingOrder, s), /order/i);
  const collision = base(); collision.formulas = { [formulaName('priority')]: 'note.order' };
  assert.throws(() => applyValueSorts(collision, s), /collision/i);
  assert.throws(() => applyValueSorts(null, s));
  assert.throws(() => applyValueSorts(base(), settings([])), /rule/i);
});
