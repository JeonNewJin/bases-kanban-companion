const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const doc = { head: {}, defaultView: { MutationObserver: Observer, ResizeObserver: Observer } };
  let card = cardFixture(), roots, redraws = 0;
  const view = { isConnected: true, ownerDocument: doc,
    classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
    style: { getPropertyValue: key => styles.get(key) || '', setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
    querySelector: () => card
  };
  const root = { isConnected: true, ownerDocument: doc, querySelectorAll: () => [view] };
  roots = [root];
  const manager = new CompactCardLayout({ version, enabled, getRoots: () => roots, redraw: () => { redraws++; manager.schedule(); } });
  return { manager, observers, classes, styles, view, root,
    redraws: () => redraws, card: value => { card = value; }, roots: value => { roots = value; } };
}

test('saved toggle restores native sizing, disconnects observers and can enable again without reload', async () => {
  const f = fixture('1.14.4', false); f.manager.refresh();
  assert.equal(f.observers.length, 0); assert.equal(f.classes.size, 0);
  f.manager.setEnabled(true); assert.ok(f.classes.has('bkc-compact-cards'));
  assert.ok(f.classes.has('bkc-horizontal-cards'));
  f.manager.schedule(); f.manager.setEnabled(false); await Promise.resolve();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0); assert.equal(f.redraws(), 2);
  assert.ok(f.observers.every(observer => observer.disconnected));
  f.manager.refresh(); assert.equal(f.redraws(), 2);
  f.card(cardFixture([1, 1, 2])); f.manager.setEnabled(true);
  assert.equal(f.styles.get('--bkc-measured-property-height'), '34px');
  f.manager.stop(); f.manager.setEnabled(true); assert.equal(f.classes.size, 0);
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
  const f = fixture(); f.manager.refresh();
  assert.ok(f.classes.has('bkc-compact-cards'));
  assert.equal(f.styles.get('--bkc-measured-property-height'), '17px');
  assert.equal(f.redraws(), 1); f.manager.refresh(); assert.equal(f.redraws(), 1);
  f.card(cardFixture([1, 1, 2]));
  f.observers.find(observer => observer.observed.has(f.view)).callback(); await Promise.resolve();
  assert.equal(f.styles.get('--bkc-measured-property-height'), '34px'); assert.equal(f.redraws(), 2);
  f.card(cardFixture([1])); f.manager.refresh(); assert.equal(f.styles.get('--bkc-measured-property-height'), '50px');
  f.card(cardFixture([])); f.manager.refresh();
  assert.deepEqual([...f.classes], ['bkc-horizontal-cards']); assert.equal(f.styles.size, 0);
});

test('horizontal layout is applied before measurement, even on empty or title-only boards', () => {
  const f = fixture(); f.card(null); f.manager.refresh();
  assert.deepEqual([...f.classes], ['bkc-horizontal-cards']);
  f.manager.io.measure = card => {
    assert.ok(f.classes.has('bkc-horizontal-cards'));
    return measureCard(card);
  };
  f.card(cardFixture()); f.manager.refresh(); assert.ok(f.classes.has('bkc-compact-cards'));
  f.card(cardFixture([])); f.manager.refresh(); assert.deepEqual([...f.classes], ['bkc-horizontal-cards']);
  f.manager.setEnabled(false); assert.equal(f.classes.size, 0);
});

test('hidden/empty view retains sizing until it returns; removal/unload restores native measurement', async () => {
  const f = fixture(); f.manager.refresh(); const card = cardFixture(); card.getBoundingClientRect = () => ({ width: 0 });
  f.card(card); f.manager.refresh(); assert.equal(f.styles.get('--bkc-measured-property-height'), '17px');
  f.card(null); f.manager.refresh(); assert.ok(f.classes.has('bkc-compact-cards'));
  f.roots([]); f.manager.refresh(); assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
  f.roots([f.root]); f.card(cardFixture()); f.manager.refresh(); f.manager.stop();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
  const redraws = f.redraws(); f.manager.schedule(); await Promise.resolve(); assert.equal(f.redraws(), redraws);
});

test('unsupported Obsidian versions do not observe or modify views', () => {
  const f = fixture('1.14.5'); f.manager.refresh();
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
  const f = fixture(); f.manager.refresh(); assert.equal(f.redraws(), 1);
  assert.equal(f.manager.scheduler.pending, false, 'css-change from our redraw is ignored');
  assert.ok(f.observers.filter(observer => observer.taken).length >= 2, 'root and head records are discarded');
  f.manager.schedule(); assert.equal(f.manager.scheduler.pending, true);
  await Promise.resolve(); assert.equal(f.redraws(), 1);
});
