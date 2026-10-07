'use strict';

const VIEW_CLASS = 'bkc-compact-cards';
const LAYOUT = 'bkc-horizontal-cards';
const HEIGHT = '--bkc-measured-property-height';
const WIDTH = '--bkc-property-min-width';

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

// Lays out official Kanban cards compactly. Boards come from KanbanTracker;
// only the tracked views and their first card are watched for size changes.
class CompactCardLayout {
  constructor(io) {
    this.io = io;
    this.active = true;
    this.enabled = io.enabled !== false;
    this.minColumnWidth = io.minColumnWidth ?? 5;
    this.views = new Map();
    this.resizers = new Map();
  }
  setEnabled(enabled) {
    if (!this.active || this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.tracker?.refresh(); else this.clear();
  }
  // Minimum width of each property block in rem; re-measures every tracked view.
  setMinColumnWidth(width) {
    if (!this.active || this.minColumnWidth === width) return;
    this.minColumnWidth = width;
    if (this.enabled) this.tracker?.refresh();
  }
  // Theme, font and snippet changes alter card sizes. Ignore our own redraw.
  onCssChange() {
    if (this.active && this.enabled && !this.redrawing) this.tracker?.schedule();
  }
  resizer(win) {
    if (!win?.ResizeObserver) return null;
    if (!this.resizers.has(win)) this.resizers.set(win, new win.ResizeObserver(() => this.tracker?.schedule()));
    return this.resizers.get(win);
  }
  redraw() {
    this.redrawing = true;
    try { this.io.redraw(); } finally { this.redrawing = false; }
    this.tracker?.discardRecords();
  }
  remove(view) {
    const item = this.views.get(view);
    if (!item) return false;
    item.resize.unobserve(view);
    if (item.card) item.resize.unobserve(item.card);
    view.classList.remove(LAYOUT);
    view.classList.remove(VIEW_CLASS); view.style.removeProperty(HEIGHT);
    view.style.removeProperty(WIDTH);
    this.views.delete(view);
    return true;
  }
  // Returns whether any view's layout classes or measured height changed.
  update(boards) {
    if (!this.active || !this.enabled) return false;
    const found = new Set();
    let changed = false;
    for (const { view } of boards) {
      let item = this.views.get(view);
      if (!item) {
        const resize = this.resizer(view.ownerDocument?.defaultView);
        if (!resize) continue;
        resize.observe(view);
        item = { resize, card: null }; this.views.set(view, item);
      }
      found.add(view);
      // Apply the optional grid first so sizing measures its rows, not the
      // official vertical layout. Keep tracking empty/title-only views too.
      if (!view.classList.contains(LAYOUT)) { view.classList.add(LAYOUT); changed = true; }
      const width = this.minColumnWidth + 'rem';
      if (view.style.getPropertyValue(WIDTH) !== width) { view.style.setProperty(WIDTH, width); changed = true; }
      const card = view.querySelector('.bases-kanban-card:has(> .bases-kanban-card-property[data-property])');
      if (item.card !== card) { if (item.card) item.resize.unobserve(item.card); if (card) item.resize.observe(card); item.card = card; }
      const measurement = card && (this.io.measure || measureCard)(card);
      if (!measurement) {
        // No rendered cards may just mean a hidden/empty viewport. Keep its last
        // measurements until cards reappear; a title-only card restores native sizing.
        if (card && card.getBoundingClientRect().width > 0 && view.classList.contains(VIEW_CLASS)) {
          view.classList.remove(VIEW_CLASS); view.style.removeProperty(HEIGHT); changed = true;
        }
        continue;
      }
      const height = measurement.height + 'px';
      if (!view.classList.contains(VIEW_CLASS) || view.style.getPropertyValue(HEIGHT) !== height) {
        view.style.setProperty(HEIGHT, height); view.classList.add(VIEW_CLASS); changed = true;
      }
    }
    for (const view of [...this.views.keys()]) if (!found.has(view)) changed = this.remove(view) || changed;
    if (changed) this.redraw();
    return changed;
  }
  // Restores native sizing on every tracked view.
  clear() {
    let changed = false;
    for (const view of [...this.views.keys()]) changed = this.remove(view) || changed;
    for (const resize of this.resizers.values()) resize.disconnect();
    this.resizers.clear();
    if (changed) this.redraw();
  }
  stop() { this.clear(); this.active = false; }
}

module.exports = { CompactCardLayout, measureCard };
