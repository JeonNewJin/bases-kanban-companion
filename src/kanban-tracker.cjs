'use strict';

const { RenderScheduler } = require('./render-scheduler.cjs');

// Official Bases DOM is not a public extension API. Fail closed on other versions.
const EMBED_VERSION = '1.14.4';
const KANBAN = '.bases-view[data-view-type="kanban"]';
const INSIDE_BOARD = '.bases-view, .bases-embed';
const BOARD_NODES = '.bases-view, .bases-embed, .bkc-embed-actions';

function touchesBoard(node) {
  return node?.nodeType === 1 && (node.matches(BOARD_NODES) || node.querySelector(BOARD_NODES) !== null);
}

// Only changes inside a board, or boards being added, removed or retargeted,
// need a refresh. Editor typing and selection changes elsewhere are ignored.
function affectsBoards(record) {
  const target = record.target;
  if (target?.nodeType === 1 && target.closest(INSIDE_BOARD)) return true;
  if (record.type === 'attributes') return record.attributeName === 'src' && touchesBoard(target);
  return [...record.addedNodes, ...record.removedNodes].some(touchesBoard);
}

// Finds official Kanban views in Markdown and Bases leaves with one observer per
// leaf, then hands the current boards to each feature in a single refresh.
class KanbanTracker {
  constructor(io) {
    this.io = io;
    this.active = true;
    this.features = [];
    this.observers = new Map();
    this.scheduler = new RenderScheduler(() => this.refresh(), 'Kanban helpers');
  }
  get supported() { return this.io.version === EMBED_VERSION; }
  add(feature) {
    this.features.push(feature);
    feature.tracker = this;
    return feature;
  }
  schedule() {
    if (this.active && this.supported) this.scheduler.schedule();
  }
  // Explicit workspace events also resume a scheduler paused by the refresh limit.
  wake() {
    if (this.active && this.supported) this.scheduler.wake();
  }
  observe(leaves) {
    const roots = new Set(leaves.map(leaf => leaf.root));
    for (const [root, observer] of this.observers) if (!roots.has(root)) { observer.disconnect(); this.observers.delete(root); }
    for (const root of roots) {
      const win = root.ownerDocument?.defaultView;
      if (!win?.MutationObserver) continue;
      this.scheduler.win = win;
      if (this.observers.has(root)) continue;
      const observer = new win.MutationObserver(records => { if (records.some(affectsBoards)) this.schedule(); });
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-view-type', 'data-property'] });
      this.observers.set(root, observer);
    }
  }
  refresh() {
    if (!this.active || !this.supported) return;
    const leaves = this.io.getLeaves().filter(leaf => leaf.root?.isConnected);
    this.observe(leaves);
    const boards = [];
    for (const leaf of leaves) {
      if (!this.observers.has(leaf.root)) continue;
      for (const view of leaf.root.querySelectorAll(KANBAN)) if (view.isConnected) boards.push({ view, leaf });
    }
    let changed = false;
    for (const feature of this.features) changed = feature.update(boards) || changed;
    this.discardRecords();
    this.scheduler.settle(changed);
  }
  // DOM records caused by our own updates must not schedule another refresh.
  discardRecords() {
    for (const observer of this.observers.values()) observer.takeRecords();
  }
  stop() {
    this.active = false;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const feature of this.features) feature.stop();
  }
}

module.exports = { KanbanTracker, EMBED_VERSION, KANBAN, affectsBoards };
