'use strict';

const { getDestination } = require('./core.cjs');

class Router {
  constructor(io, getSettings) {
    this.io = io;
    this.getSettings = getSettings;
    this.active = true;
    this.queue = Promise.resolve();
    this.conflicts = new Set();
  }
  stop() { this.active = false; }
  plan(file) {
    if (!this.active || file?.extension !== 'md' || this.io.fileAt(file.path) !== file) return null;
    const destination = getDestination(file.parent?.path, this.io.metadata(file), this.getSettings());
    if (!destination || destination === file.parent?.path) return null;
    const target = destination + '/' + file.name;
    return { file, source: file.path, target, conflict: Boolean(this.io.fileAt(target)) };
  }
  preview(files) { return files.map(file => this.plan(file)).filter(Boolean); }
  enqueue(file) {
    if (!this.active || file?.extension !== 'md') return;
    this.queue = this.queue.then(() => this.reconcile(file)).catch(error => {
      this.io.notice('Could not move note: ' + (error?.message || String(error)));
    });
  }
  conflict(plan) {
    const key = plan.source + ' -> ' + plan.target;
    if (!plan.conflict) { this.conflicts.delete(key); return false; }
    if (!this.conflicts.has(key)) {
      this.conflicts.add(key);
      this.io.notice('Note not moved: a file already exists at ' + plan.target);
    }
    return true;
  }
  async reconcile(file) {
    const plan = this.plan(file);
    if (!plan || this.conflict(plan)) return;
    await this.io.ensureFolder(plan.target.slice(0, plan.target.lastIndexOf('/')));
    // Metadata, configuration, file location, or conflicts can change during the await.
    const latest = this.plan(file);
    if (!latest || latest.source !== plan.source || latest.target !== plan.target || this.conflict(latest)) return;
    await this.io.rename(file, latest.target);
  }
}

module.exports = { Router };
