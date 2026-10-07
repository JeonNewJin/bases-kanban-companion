'use strict';

const { KANBAN } = require('./kanban-tracker.cjs');

// Adds an open button to official Kanban embeds in Markdown notes.
class EmbeddedBoardButtons {
  constructor(io) {
    this.io = io;
    this.active = true;
    this.buttons = new Map();
    this.leaves = new Map();
  }
  target(embed, leaf) {
    if (!embed.isConnected || !leaf.root.contains(embed) || !embed.querySelector(KANBAN)) return null;
    const wrapper = embed.closest('.internal-embed[src]');
    if (!wrapper || !leaf.root.contains(wrapper)) return null;
    const link = wrapper.getAttribute('src');
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    let sourcePath = leaf.sourcePath;
    const parents = [];
    for (let parent = wrapper.parentElement?.closest('.internal-embed[src]'); parent && leaf.root.contains(parent); parent = parent.parentElement?.closest('.internal-embed[src]')) parents.unshift(parent);
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
  insert(embed, root) {
    const doc = embed.ownerDocument;
    const bar = doc.createElement('div');
    bar.className = 'bkc-embed-actions';
    const button = doc.createElement('button');
    button.className = 'bkc-open-board';
    button.type = 'button';
    button.textContent = 'Open';
    button.setAttribute('aria-label', 'Open board in new tab');
    const click = async event => {
      event.preventDefault(); event.stopPropagation();
      if (!this.active) return;
      try {
        // Resolve again at click time; the note or its links may have changed.
        const leaf = this.leaves.get(root);
        const current = leaf && this.target(embed, leaf);
        if (!current) throw new Error('The embedded board changed or is unavailable.');
        await this.io.open(current.link, current.sourcePath);
      } catch (error) { this.io.notice('Cannot open board: ' + error.message); }
    };
    button.addEventListener('click', click);
    bar.appendChild(button);
    embed.prepend(bar);
    this.buttons.set(embed, { bar, button, click });
  }
  remove(embed) {
    const item = this.buttons.get(embed);
    if (!item) return;
    item.button.removeEventListener('click', item.click);
    item.bar.remove();
    this.buttons.delete(embed);
  }
  // Returns whether a button had to be (re)inserted.
  update(boards) {
    if (!this.active) return false;
    this.leaves = new Map(boards.map(({ leaf }) => [leaf.root, leaf]));
    const found = new Set();
    let changed = false;
    for (const { view, leaf } of boards) {
      if (!leaf.sourcePath) continue;
      const embed = view.closest('.bases-embed');
      if (!embed || found.has(embed)) continue;
      let target;
      try { target = this.target(embed, leaf); } catch { target = null; }
      if (!target) continue;
      found.add(embed);
      const previous = this.buttons.get(embed);
      if (previous && embed.contains(previous.bar)) continue;
      this.remove(embed);
      this.insert(embed, leaf.root);
      changed = true;
    }
    for (const embed of [...this.buttons.keys()]) if (!found.has(embed)) this.remove(embed);
    return changed;
  }
  stop() {
    this.active = false;
    for (const embed of [...this.buttons.keys()]) this.remove(embed);
    this.leaves.clear();
  }
}

module.exports = { EmbeddedBoardButtons };
