'use strict';

// Observer callbacks must never re-render synchronously. If the editor or the
// native Bases renderer undoes a DOM change, a microtask-driven refresh would
// fight it forever without yielding, freezing Obsidian. Defer to the next frame
// and stop after a run of refreshes that keep changing the DOM.
const CHURN_LIMIT = 20;

class RenderScheduler {
  constructor(run, name) {
    this.run = run;
    this.name = name;
    this.win = null;
    this.pending = false;
    this.churn = 0;
    this.halted = false;
  }
  schedule() {
    if (this.pending || this.halted) return;
    this.pending = true;
    const next = () => { this.pending = false; this.run(); };
    // A closed popout never runs its frames; fall back so refreshes are not lost.
    const win = this.win && !this.win.closed ? this.win : null;
    if (typeof win?.requestAnimationFrame === 'function') win.requestAnimationFrame(next);
    else void Promise.resolve().then(next);
  }
  // Explicit workspace events re-enable a halted scheduler.
  wake() {
    this.halted = false;
    this.churn = 0;
    this.schedule();
  }
  // Returns false once consecutive refreshes have changed the DOM too often.
  settle(changed) {
    if (!changed) { this.churn = 0; return true; }
    if (++this.churn < CHURN_LIMIT) return true;
    if (!this.halted) console.warn(`[Bases Kanban Companion] ${this.name}: DOM kept changing; paused until the next workspace change.`);
    this.halted = true;
    return false;
  }
}

module.exports = { RenderScheduler, CHURN_LIMIT };
