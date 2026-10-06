'use strict';

const { RenderScheduler } = require('./render-scheduler.cjs');

// Official embed DOM is not a public extension API. Fail closed on other versions.
const EMBED_VERSION = '1.14.4';
const KANBAN = '.bases-view[data-view-type="kanban"]';

class EmbeddedBoardButtons {
  constructor(io) {
    this.io = io;
    this.active = true;
    this.scopes = new Map();
    this.buttons = new Map();
    this.scheduler = new RenderScheduler(() => { if (this.active) this.refresh(); }, 'board buttons');
  }
  schedule() {
    if (this.active) this.scheduler.schedule();
  }
  wake() {
    if (this.active) this.scheduler.wake();
  }
  target(embed, scope) {
    if (!embed.isConnected || !scope.root.contains(embed) || !embed.querySelector(KANBAN)) return null;
    const wrapper = embed.closest('.internal-embed[src]');
    if (!wrapper || !scope.root.contains(wrapper)) return null;
    const link = wrapper.getAttribute('src');
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    let sourcePath = scope.sourcePath;
    const parents = [];
    for (let parent = wrapper.parentElement?.closest('.internal-embed[src]'); parent && scope.root.contains(parent); parent = parent.parentElement?.closest('.internal-embed[src]')) parents.unshift(parent);
    for (const parent of parents) {
      const parsed = this.io.parseLink(parent.getAttribute('src'));
      const file = this.io.resolve(parsed.path, sourcePath);
      if (!file || file.extension !== 'md' || !this.io.current(file)) return null;
      sourcePath = file.path;
    }
    const parsed = this.io.parseLink(link);
    if (!parsed.path || !/\.base$/i.test(parsed.path)) return null;
    const file = this.io.resolve(parsed.path, sourcePath);
    if (!file || file.extension !== 'base' || !this.io.current(file)) return null;
    return { link: file.path + parsed.subpath, sourcePath };
  }
  remove(embed) {
    const item = this.buttons.get(embed);
    if (!item) return;
    item.button.removeEventListener('click', item.click);
    item.bar.remove();
    this.buttons.delete(embed);
  }
  refresh() {
    if (!this.active || this.io.version !== EMBED_VERSION) return;
    const scopes = new Map(this.io.getScopes().filter(scope => scope.root?.isConnected).map(scope => [scope.root, scope]));
    for (const [root, item] of this.scopes) {
      if (!scopes.has(root)) { item.observer.disconnect(); this.scopes.delete(root); }
    }
    for (const [root, scope] of scopes) {
      if (!this.scopes.has(root)) {
        const Observer = root.ownerDocument.defaultView?.MutationObserver;
        if (!Observer) continue;
        const observer = new Observer(() => this.schedule());
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-view-type'] });
        this.scopes.set(root, { observer });
      }
      this.scopes.get(root).scope = scope;
      this.scheduler.win = root.ownerDocument.defaultView;
    }
    const found = new Set();
    let changed = false;
    for (const { scope } of this.scopes.values()) {
      for (const embed of scope.root.querySelectorAll('.bases-embed')) {
        let target;
        try { target = this.target(embed, scope); } catch { target = null; }
        if (!target) continue;
        found.add(embed);
        const previous = this.buttons.get(embed);
        if (previous && embed.contains(previous.bar)) continue;
        this.remove(embed);
        const bar = embed.ownerDocument.createElement('div');
        bar.className = 'bkc-embed-actions';
        const button = embed.ownerDocument.createElement('button');
        button.className = 'bkc-open-board';
        button.type = 'button';
        button.textContent = '열기 ↗';
        button.setAttribute('aria-label', '열기 — 새 탭');
        const click = async event => {
          event.preventDefault(); event.stopPropagation();
          if (!this.active) return;
          try {
            const currentScope = this.scopes.get(scope.root)?.scope;
            const current = currentScope && this.target(embed, currentScope);
            if (!current) throw new Error('The embedded board changed or is unavailable.');
            await this.io.open(current.link, current.sourcePath);
          } catch (error) { this.io.notice('Cannot open board: ' + error.message); }
        };
        button.addEventListener('click', click);
        bar.appendChild(button);
        embed.prepend(bar);
        this.buttons.set(embed, { bar, button, click });
        changed = true;
      }
    }
    for (const embed of this.buttons.keys()) if (!found.has(embed)) this.remove(embed);
    // Our own insertions must not schedule another refresh.
    for (const item of this.scopes.values()) item.observer.takeRecords?.();
    this.scheduler.settle(changed);
  }
  stop() {
    this.active = false;
    for (const item of this.scopes.values()) item.observer.disconnect();
    this.scopes.clear();
    for (const embed of this.buttons.keys()) this.remove(embed);
  }
}

module.exports = { EmbeddedBoardButtons, EMBED_VERSION };
