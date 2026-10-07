const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { KanbanTracker } = require('../src/kanban-tracker.cjs');
const { CompactCardLayout, measureCard } = require('../src/card-layout.cjs');

function cardFixture(rows = [1, 1, 1]) {
  const property = (top, bottom, title = false) => ({
    matches: selector => selector === '.bases-kanban-card-property[data-property]',
    classList: { contains: name => title && name === 'mod-title' },
    getBoundingClientRect: () => ({ top, bottom, height: bottom - top, width: 80 })
  });
  return {
    children: [property(8, 32, true), ...rows.map(row => property(40 + (row - 1) * 50, 82 + (row - 1) * 50))],
    getBoundingClientRect: () => ({ width: 280 })
  };
}

function fixture(version = '1.14.4', enabled = true) {
  const observers = [], classes = new Set(), styles = new Map();
  class Observer {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    takeRecords() { this.taken = (this.taken || 0) + 1; return []; }
  }
  const doc = { defaultView: { MutationObserver: Observer, ResizeObserver: Observer } };
  let card = cardFixture(), roots, redraws = 0;
  const view = { isConnected: true, ownerDocument: doc,
    classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
    style: { getPropertyValue: key => styles.get(key) || '', setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
    querySelector: () => card
  };
  const root = { isConnected: true, ownerDocument: doc, querySelectorAll: () => [view] };
  roots = [root];
  const tracker = new KanbanTracker({ version, getLeaves: () => roots.map(root => ({ root, sourcePath: null })) });
  // Like Obsidian, redraw emits css-change synchronously.
  const manager = tracker.add(new CompactCardLayout({ enabled, redraw: () => { redraws++; manager.onCssChange(); } }));
  const resizer = () => observers.find(observer => observer.observed.has(view));
  return { tracker, manager, observers, resizer, classes, styles, view, root,
    redraws: () => redraws, card: value => { card = value; }, roots: value => { roots = value; } };
}

test('saved toggle restores native sizing, releases resize observers and can enable again without reload', async () => {
  const f = fixture('1.14.4', false); f.tracker.refresh();
  assert.equal(f.resizer(), undefined); assert.equal(f.classes.size, 0);
  f.manager.setEnabled(true); assert.ok(f.classes.has('bkc-compact-cards'));
  assert.ok(f.classes.has('bkc-horizontal-cards'));
  f.tracker.schedule(); f.manager.setEnabled(false); await Promise.resolve();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0); assert.equal(f.redraws(), 2);
  assert.equal(f.resizer(), undefined);
  f.tracker.refresh(); assert.equal(f.redraws(), 2);
  f.card(cardFixture([1, 1, 2])); f.manager.setEnabled(true);
  assert.equal(f.styles.get('--bkc-measured-property-height'), '34px');
  f.tracker.stop(); f.manager.setEnabled(true); assert.equal(f.classes.size, 0); assert.equal(f.manager.active, false);
});

test('compact measurements include grid row gaps, round upward and ignore the native card height', () => {
  assert.equal(measureCard(cardFixture()).height, 17); // (8 + 42) / 3, rounded up
  assert.equal(measureCard(cardFixture([1, 1, 2])).height, 34);
  assert.equal(measureCard(cardFixture([1, 1, 2, 2])).height, 25);
  assert.equal(measureCard(cardFixture([])), null);
  const card = cardFixture(); card.getBoundingClientRect = () => ({ width: 0 });
  assert.equal(measureCard(card), null);
});

test('layout changes native measurement CSS only, is idempotent and handles resize/property changes', async () => {
  const f = fixture(); f.tracker.refresh();
  assert.ok(f.classes.has('bkc-compact-cards'));
  assert.equal(f.styles.get('--bkc-measured-property-height'), '17px');
  assert.equal(f.redraws(), 1); f.tracker.refresh(); assert.equal(f.redraws(), 1);
  f.card(cardFixture([1, 1, 2]));
  f.resizer().callback(); await Promise.resolve();
  assert.equal(f.styles.get('--bkc-measured-property-height'), '34px'); assert.equal(f.redraws(), 2);
  f.card(cardFixture([1])); f.tracker.refresh(); assert.equal(f.styles.get('--bkc-measured-property-height'), '50px');
  f.card(cardFixture([])); f.tracker.refresh();
  assert.deepEqual([...f.classes], ['bkc-horizontal-cards']); assert.equal(f.styles.has('--bkc-measured-property-height'), false);
});

test('horizontal layout is applied before measurement, even on empty or title-only boards', () => {
  const f = fixture(); f.card(null); f.tracker.refresh();
  assert.deepEqual([...f.classes], ['bkc-horizontal-cards']);
  f.manager.io.measure = card => {
    assert.ok(f.classes.has('bkc-horizontal-cards'));
    return measureCard(card);
  };
  f.card(cardFixture()); f.tracker.refresh(); assert.ok(f.classes.has('bkc-compact-cards'));
  f.card(cardFixture([])); f.tracker.refresh(); assert.deepEqual([...f.classes], ['bkc-horizontal-cards']);
  f.manager.setEnabled(false); assert.equal(f.classes.size, 0);
});

test('hidden/empty view retains sizing until it returns; removal/unload restores native measurement', async () => {
  const f = fixture(); f.tracker.refresh(); const card = cardFixture(); card.getBoundingClientRect = () => ({ width: 0 });
  f.card(card); f.tracker.refresh(); assert.equal(f.styles.get('--bkc-measured-property-height'), '17px');
  f.card(null); f.tracker.refresh(); assert.ok(f.classes.has('bkc-compact-cards'));
  f.roots([]); f.tracker.refresh(); assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
  assert.equal(f.resizer(), undefined);
  f.roots([f.root]); f.card(cardFixture()); f.tracker.refresh(); f.tracker.stop();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
  const redraws = f.redraws(); f.tracker.schedule(); f.manager.onCssChange(); await Promise.resolve(); assert.equal(f.redraws(), redraws);
});

test('unsupported Obsidian versions do not observe or modify views', () => {
  const f = fixture('1.14.5'); f.tracker.refresh();
  assert.equal(f.observers.length, 0); assert.equal(f.styles.size, 0); assert.equal(f.redraws(), 0);
});

test('CSS preserves real card spacing and applies measurement shares only to native placeholders', () => {
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  assert.match(css, /\.bkc-compact-cards \.bases-kanban-card:not\(:has\(> \.bases-kanban-card-property\[data-property\]\)\)\s*\{\s*gap: 0;/);
  assert.match(css, /property:not\(\[data-property\]\):not\(\.mod-title\)\s*\{\s*height: var\(--bkc-measured-property-height\);/);
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].map(match => match[1].trim()).filter(selector => selector.startsWith('.bases-view[data-view-type="kanban"]'));
  assert.equal(selectors.length, 6);
  assert.ok(selectors.every(selector => /\]\.bkc-(horizontal|compact)-cards /.test(selector)), 'No card layout rule may apply when the option is off');
});

test('css-change and DOM records caused by our own redraw do not schedule another refresh', async () => {
  const f = fixture(); f.tracker.refresh(); assert.equal(f.redraws(), 1);
  assert.equal(f.tracker.scheduler.pending, false, 'css-change from our redraw is ignored');
  assert.ok(f.observers.find(observer => observer.observed.has(f.root)).taken >= 2, 'tracker records are discarded after redraw and refresh');
  f.manager.onCssChange(); assert.equal(f.tracker.scheduler.pending, true, 'other css-change events re-measure');
  await Promise.resolve(); assert.equal(f.redraws(), 1);
});

test('property block width is applied before measuring and changes re-measure tracked views', () => {
  const f = fixture(); f.tracker.refresh();
  assert.equal(f.styles.get('--bkc-property-min-width'), '5rem');
  const redraws = f.redraws(); f.manager.setMinColumnWidth(4);
  assert.equal(f.styles.get('--bkc-property-min-width'), '4rem'); assert.equal(f.redraws(), redraws + 1);
  f.manager.setMinColumnWidth(4); assert.equal(f.redraws(), redraws + 1);
  f.manager.setEnabled(false); assert.equal(f.styles.has('--bkc-property-min-width'), false);
  f.manager.setMinColumnWidth(6); assert.equal(f.styles.size, 0);
  f.manager.setEnabled(true); assert.equal(f.styles.get('--bkc-property-min-width'), '6rem');
});
