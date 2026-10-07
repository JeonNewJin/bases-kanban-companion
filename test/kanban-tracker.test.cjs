const test = require('node:test');
const assert = require('node:assert/strict');
const { KanbanTracker, affectsBoards } = require('../src/kanban-tracker.cjs');

// Minimal element: classes, children and the selector forms the tracker uses.
class Node {
  constructor(classes = '', children = []) {
    this.nodeType = 1; this.classes = classes.split(' ').filter(Boolean); this.children = []; this.attributes = {};
    for (const child of children) this.append(child);
  }
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  matches(selector) {
    return selector.split(',').some(part => {
      const match = part.trim().match(/^\.([\w-]+)(?:\[data-view-type="(\w+)"\])?$/);
      return !!match && this.classes.includes(match[1]) && (!match[2] || this.attributes['data-view-type'] === match[2]);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get isConnected() { return this.connected === true || !!this.parentElement?.isConnected; }
}
const record = (target, extra = {}) => ({ type: 'childList', target, addedNodes: [], removedNodes: [], ...extra });

function board() {
  const view = new Node('bases-view'); view.attributes['data-view-type'] = 'kanban';
  const card = view.append(new Node('bases-kanban-card'));
  const embed = new Node('bases-embed', [view]);
  return { view, card, embed, wrapper: new Node('internal-embed', [embed]) };
}

test('only DOM changes inside, adding, removing or retargeting boards are relevant', () => {
  const line = new Node('cm-line'), editor = new Node('cm-content', [line]), b = board(); editor.append(b.wrapper);
  assert.equal(affectsBoards(record(line, { addedNodes: [{ nodeType: 3 }] })), false, 'typing');
  assert.equal(affectsBoards(record(editor, { addedNodes: [new Node('cm-line')] })), false, 'new editor line next to a board');
  assert.equal(affectsBoards(record(editor, { type: 'attributes', attributeName: 'data-property' })), false);
  assert.equal(affectsBoards(record(b.view, { addedNodes: [new Node('bases-kanban-card')] })), true, 'cards rendered');
  assert.equal(affectsBoards(record(b.embed, { removedNodes: [new Node('bkc-embed-actions')] })), true, 'open button removed');
  assert.equal(affectsBoards(record(editor, { addedNodes: [board().wrapper] })), true, 'board embedded');
  assert.equal(affectsBoards(record(editor, { removedNodes: [b.wrapper] })), true, 'board removed');
  assert.equal(affectsBoards(record(b.wrapper, { type: 'attributes', attributeName: 'src' })), true, 'embed retargeted');
  assert.equal(affectsBoards(record(new Node('internal-embed'), { type: 'attributes', attributeName: 'src' })), false, 'other embed');
});

function fixture(version = '1.14.4') {
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; }
    disconnect() { this.disconnected = true; }
    takeRecords() { this.taken = (this.taken || 0) + 1; return []; }
  }
  const doc = { defaultView: { MutationObserver: Observer } };
  const leaf = (sourcePath = 'Notes/Project.md') => { const root = new Node('leaf'); root.connected = true; root.ownerDocument = doc; return { root, sourcePath }; };
  let leaves = [leaf(), leaf(null)];
  const updates = [], stops = [];
  const feature = { update: boards => { updates.push(boards); return feature.changes; }, stop: () => stops.push(true), changes: false };
  const tracker = new KanbanTracker({ version, getLeaves: () => leaves });
  tracker.add(feature);
  return { tracker, feature, updates, stops, observers, leaf, leaves: value => { if (value) leaves = value; return leaves; } };
}

test('one observer per leaf; features receive Kanban views from Markdown and Bases leaves together', async () => {
  const f = fixture(), [note, base] = f.leaves();
  const first = board(), second = board(), table = board();
  note.root.append(first.wrapper); base.root.append(second.wrapper);
  table.view.attributes['data-view-type'] = 'table'; note.root.append(table.wrapper);
  f.tracker.refresh(); f.tracker.refresh();
  assert.equal(f.observers.length, 2);
  assert.deepEqual(f.updates[0].map(({ view, leaf }) => [view, leaf.sourcePath]), [[first.view, 'Notes/Project.md'], [second.view, null]]);
  assert.deepEqual(f.observers[0].options.attributeFilter, ['src', 'data-view-type', 'data-property']);
  assert.ok(f.observers.every(observer => observer.taken === 2), 'own changes are discarded after every refresh');
  f.observers[0].callback([record(note.root, { addedNodes: [new Node('cm-line')] })]); await Promise.resolve();
  assert.equal(f.updates.length, 2, 'unrelated mutations do not refresh');
  f.observers[0].callback([record(first.view, { addedNodes: [new Node('bases-kanban-card')] })]); await Promise.resolve();
  assert.equal(f.updates.length, 3);
});

test('closed or disconnected leaves lose their observers; unsupported versions observe nothing', () => {
  const f = fixture(); f.tracker.refresh(); const [, base] = f.leaves();
  base.root.connected = false; f.tracker.refresh();
  assert.equal(f.observers[1].disconnected, true); assert.equal(f.tracker.observers.size, 1);
  f.leaves([]); f.tracker.refresh(); assert.equal(f.observers[0].disconnected, true);
  const old = fixture('1.14.5'); old.tracker.refresh(); old.tracker.schedule(); old.tracker.wake();
  assert.equal(old.observers.length, 0); assert.equal(old.updates.length, 0);
});

test('features that keep changing the DOM pause refreshes until a workspace event wakes them', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const f = fixture(); f.feature.changes = true; f.tracker.refresh();
    for (let i = 0; i < 40; i++) { f.tracker.schedule(); await Promise.resolve(); }
    const paused = f.updates.length; assert.ok(paused < 25, `paused after ${paused} refreshes`);
    f.tracker.schedule(); await Promise.resolve(); assert.equal(f.updates.length, paused);
    f.tracker.wake(); await Promise.resolve(); assert.equal(f.updates.length, paused + 1);
  } finally { console.warn = warn; }
});

test('stop disconnects observers, stops features and ignores later refreshes', async () => {
  const f = fixture(); f.tracker.refresh(); f.tracker.schedule(); f.tracker.stop();
  assert.ok(f.observers.every(observer => observer.disconnected)); assert.equal(f.stops.length, 1);
  await Promise.resolve(); f.tracker.refresh(); assert.equal(f.updates.length, 1);
});
