'use strict';

const { EMBED_VERSION } = require('./embedded-board.cjs');
const { RenderScheduler } = require('./render-scheduler.cjs');
const VIEW = '.bases-view[data-view-type="kanban"]';
const CLASS = 'bkc-compact-cards';
const LAYOUT = 'bkc-horizontal-cards';
const HEIGHT = '--bkc-measured-property-height';

// The native view multiplies one placeholder height by the property count.
// Give it an upper-rounded share of the actual grid's total metadata height.
// Its own renderer then retains ownership of card offsets, scrolling and drops.
function measureCard(card) {
  const props = Array.from(card.children).filter(el => el.matches('.bases-kanban-card-property[data-property]'));
  const title = props.find(el => el.classList.contains('mod-title'));
  const metadata = props.filter(el => el !== title);
  if (!title || metadata.length === 0 || metadata.length > 128) return null;
  const bounds = card.getBoundingClientRect(), heading = title.getBoundingClientRect();
  const rects = metadata.map(el => el.getBoundingClientRect());
  if (bounds.width <= 0 || heading.height <= 0 || rects.some(rect => rect.height <= 0 || rect.width <= 0)) return null;
  const space = Math.max(...rects.map(rect => rect.bottom)) - heading.bottom;
  if (!Number.isFinite(space) || space <= 0) return null;
  return { card, count: metadata.length, height: Math.ceil(space / metadata.length) };
}

class CompactCardLayout {
  constructor(io) {
    this.io = io; this.active = true; this.enabled = io.enabled !== false;
    this.roots = new Map(); this.views = new Map(); this.heads = new Map();
    this.scheduler = new RenderScheduler(() => { if (this.active) this.refresh(); }, 'compact cards');
  }
  setEnabled(enabled) {
    if (!this.active || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.refresh(); else this.clear();
  }
  schedule() {
    // Ignore the css-change event triggered by our own redraw.
    if (this.active && this.enabled && !this.redrawing) this.scheduler.schedule();
  }
  wake() {
    if (this.active && this.enabled) this.scheduler.wake();
  }
  redraw() {
    this.redrawing = true;
    try { this.io.redraw(); } finally { this.redrawing = false; }
    // Theme and style plugins react to css-change synchronously; drop those records.
    for (const observer of [...this.roots.values(), ...this.heads.values()]) observer.takeRecords?.();
  }
  remove(view) {
    const item = this.views.get(view);
    if (!item) return false;
    item.resize.disconnect();
    view.classList.remove(LAYOUT);
    view.classList.remove(CLASS); view.style.removeProperty(HEIGHT);
    this.views.delete(view);
    return true;
  }
  refresh() {
    if (!this.active || !this.enabled || this.io.version !== EMBED_VERSION) return;
    const roots = new Set(this.io.getRoots().filter(root => root?.isConnected));
    const heads = new Set();
    for (const [root, observer] of this.roots) if (!roots.has(root)) { observer.disconnect(); this.roots.delete(root); }
    for (const root of roots) {
      const win = root.ownerDocument?.defaultView;
      if (!win?.MutationObserver || !win?.ResizeObserver) continue;
      this.scheduler.win = win;
      if (!this.roots.has(root)) {
        const observer = new win.MutationObserver(() => this.schedule());
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-view-type', 'data-property'] });
        this.roots.set(root, observer);
      }
      const head = root.ownerDocument.head;
      if (head) {
        heads.add(head);
        if (!this.heads.has(head)) {
          // Plugin CSS loads after onload; also recalculate after font/theme CSS changes.
          const observer = new win.MutationObserver(() => this.schedule());
          observer.observe(head, { childList: true, subtree: true, characterData: true });
          this.heads.set(head, observer);
        }
      }
    }
    for (const [head, observer] of this.heads) if (!heads.has(head)) { observer.disconnect(); this.heads.delete(head); }
    const found = new Set();
    let changed = false;
    for (const root of this.roots.keys()) for (const view of root.querySelectorAll(VIEW)) {
      if (!view.isConnected) continue;
      found.add(view);
      let item = this.views.get(view);
      if (!item) {
        const resize = new view.ownerDocument.defaultView.ResizeObserver(() => this.schedule());
        resize.observe(view);
        item = { resize }; this.views.set(view, item);
      }
      // Apply the optional grid first so sizing measures its rows, not the
      // official vertical layout. Keep tracking empty/title-only views too.
      if (!view.classList.contains(LAYOUT)) { view.classList.add(LAYOUT); changed = true; }
      const card = view.querySelector('.bases-kanban-card:has(> .bases-kanban-card-property[data-property])');
      if (item.card !== card) { if (item.card) item.resize.unobserve(item.card); if (card) item.resize.observe(card); item.card = card; }
      const measurement = card && (this.io.measure || measureCard)(card);
      if (!measurement) {
        // No rendered cards may just mean a hidden/empty viewport. Keep its last
        // measurements until cards reappear; a title-only card restores native sizing.
        if (card && card.getBoundingClientRect().width > 0 && view.classList.contains(CLASS)) {
          view.classList.remove(CLASS); view.style.removeProperty(HEIGHT); changed = true;
        }
        continue;
      }
      const height = measurement.height + 'px';
      if (!view.classList.contains(CLASS) || view.style.getPropertyValue(HEIGHT) !== height) {
        view.style.setProperty(HEIGHT, height); view.classList.add(CLASS); changed = true;
      }
    }
    for (const view of this.views.keys()) if (!found.has(view)) changed = this.remove(view) || changed;
    if (changed) this.redraw();
    this.scheduler.settle(changed);
  }
  clear() {
    for (const observer of [...this.roots.values(), ...this.heads.values()]) observer.disconnect();
    this.roots.clear(); this.heads.clear();
    let changed = false;
    for (const view of this.views.keys()) changed = this.remove(view) || changed;
    if (changed) this.redraw();
  }
  stop() { this.active = false; this.clear(); }
}

module.exports = { CompactCardLayout, measureCard };
