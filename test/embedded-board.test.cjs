const test = require('node:test');
const assert = require('node:assert/strict');
const { EmbeddedBoardButtons } = require('../src/embedded-board.cjs');

class Element {
  constructor(doc, classes = '') { this.ownerDocument = doc; this.className = classes; this.children = []; this.attributes = {}; this.listeners = {}; }
  get isConnected() { return this.connected === true || !!this.parentElement?.isConnected; }
  appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
  prepend(child) { child.remove(); this.children.unshift(child); child.parentElement = this; }
  remove() { if (this.parentElement) { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; } }
  contains(el) { return el === this || this.children.some(child => child.contains(el)); }
  matches(selector) {
    if (selector === '.internal-embed[src]') return this.className.split(' ').includes('internal-embed') && this.attributes.src !== undefined;
    if (selector === '.bases-view[data-view-type="kanban"]') return this.className === 'bases-view' && this.attributes['data-view-type'] === 'kanban';
    return this.className.split(' ').includes(selector.slice(1));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  removeEventListener(event, callback) { if (this.listeners[event] === callback) delete this.listeners[event]; }
  async click() { await this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }); }
}
function fixture(version = '1.14.4') {
  const observers = [], opened = [], notices = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(root) { this.root = root; }
    disconnect() { this.disconnected = true; }
    takeRecords() { this.taken = (this.taken || 0) + 1; return []; }
  }
  const doc = { defaultView: { MutationObserver: Observer }, createElement: () => new Element(doc) };
  const root = new Element(doc); root.connected = true;
  const files = new Map([['Notes/Board.base', { path: 'Notes/Board.base', extension: 'base' }], ['Other/Board.base', { path: 'Other/Board.base', extension: 'base' }], ['Notes/Child.md', { path: 'Notes/Child.md', extension: 'md' }]]);
  let scopes = [{ root, sourcePath: 'Notes/Project.md' }];
  const manager = new EmbeddedBoardButtons({
    version, getScopes: () => scopes,
    parseLink: link => { const index = link.indexOf('#'); return index < 0 ? { path: link, subpath: '' } : { path: link.slice(0, index), subpath: link.slice(index) }; },
    resolve: (path, source) => files.get(path) || files.get(source.slice(0, source.lastIndexOf('/') + 1) + path),
    current: file => files.get(file.path) === file,
    open: async (link, source) => opened.push({ link, source }), notice: text => notices.push(text)
  });
  const embed = (src = 'Board.base', type = 'kanban', parent = root) => {
    const wrapper = parent.appendChild(new Element(doc, 'internal-embed')); if (src !== null) wrapper.setAttribute('src', src);
    const base = wrapper.appendChild(new Element(doc, 'bases-embed'));
    const view = base.appendChild(new Element(doc, 'bases-view')); view.setAttribute('data-view-type', type);
    return { wrapper, base, view };
  };
  return { manager, doc, root, files, opened, notices, observers, embed, scopes: value => { scopes = value; } };
}

test('external Kanban embeds receive one button; click resolves their file and view in a new tab', async () => {
  const f = fixture(), e = f.embed('Board.base#Kanban'); f.manager.refresh(); f.manager.refresh();
  const buttons = e.base.querySelectorAll('.bkc-open-board');
  assert.equal(buttons.length, 1); assert.equal(buttons[0].textContent, '열기 ↗');
  assert.equal(e.base.children[0].className, 'bkc-embed-actions');
  await buttons[0].click(); assert.deepEqual(f.opened, [{ link: 'Notes/Board.base#Kanban', source: 'Notes/Project.md' }]);
  f.manager.stop(); assert.equal(e.base.querySelector('.bkc-open-board'), null);
  assert.ok(f.observers.every(o => o.disconnected)); await buttons[0].click(); assert.equal(f.opened.length, 1);
});

test('inline Bases, non-Kanban views, invalid targets and unsupported versions have no buttons', () => {
  for (const [src, type] of [[null, 'kanban'], ['Board.base', 'table'], ['Child.md', 'kanban'], ['Missing.base', 'kanban'], ['https://example.com/Board.base', 'kanban']]) {
    const f = fixture(), e = f.embed(src, type); f.manager.refresh(); assert.equal(e.base.querySelector('.bkc-open-board'), null);
  }
  const f = fixture('1.14.5'), e = f.embed(); f.manager.refresh();
  assert.equal(e.base.querySelector('.bkc-open-board'), null); assert.equal(f.observers.length, 0);
});

test('view changes, rerenders and removed leaves clean up buttons and observers', async () => {
  const f = fixture(), e = f.embed(); f.manager.refresh();
  e.view.setAttribute('data-view-type', 'table'); f.observers[0].callback(); await Promise.resolve();
  assert.equal(e.base.querySelector('.bkc-open-board'), null);
  e.view.setAttribute('data-view-type', 'kanban'); f.manager.refresh();
  e.base.children[0].remove(); f.manager.refresh(); assert.equal(e.base.querySelectorAll('.bkc-open-board').length, 1);
  f.scopes([]); f.manager.refresh(); assert.equal(e.base.querySelector('.bkc-open-board'), null);
  assert.equal(f.observers[0].disconnected, true);
});

test('relative source paths and duplicate filenames are resolved per leaf, including other windows and nested notes', async () => {
  const f = fixture(), first = f.embed();
  const otherRoot = new Element(f.doc); otherRoot.connected = true;
  const second = f.embed('Board.base', 'kanban', otherRoot);
  f.scopes([{ root: f.root, sourcePath: 'Notes/Project.md' }, { root: otherRoot, sourcePath: 'Other/Project.md' }]);
  f.manager.refresh(); await first.base.querySelector('.bkc-open-board').click(); await second.base.querySelector('.bkc-open-board').click();
  assert.deepEqual(f.opened.map(item => item.link), ['Notes/Board.base', 'Other/Board.base']);
  const nested = f.root.appendChild(new Element(f.doc, 'internal-embed')); nested.setAttribute('src', 'Other/Child.md');
  f.files.set('Other/Child.md', { path: 'Other/Child.md', extension: 'md' });
  const child = f.embed('Board.base', 'kanban', nested); f.manager.refresh(); await child.base.querySelector('.bkc-open-board').click();
  assert.equal(f.opened.at(-1).link, 'Other/Board.base'); assert.equal(f.opened.at(-1).source, 'Other/Child.md');
});

test('stale targets and removed embeds never open a different file; opening failures show a notice', async () => {
  const f = fixture(), e = f.embed(); f.manager.refresh(); const button = e.base.querySelector('.bkc-open-board');
  f.files.delete('Notes/Board.base'); await button.click(); assert.equal(f.opened.length, 0); assert.equal(f.notices.length, 1);
  e.wrapper.remove(); await button.click(); assert.equal(f.opened.length, 0);
  f.files.set('Notes/Board.base', { path: 'Notes/Board.base', extension: 'base' });
  const replacement = f.embed(); f.manager.refresh();
  f.manager.io.open = async () => { throw new Error('Open failed'); };
  await replacement.base.querySelector('.bkc-open-board').click(); assert.match(f.notices.at(-1), /Open failed/);
});

test('an embed whose button keeps being removed stops being refreshed instead of looping', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const f = fixture(), e = f.embed(); f.manager.refresh();
    assert.ok(f.observers[0].taken >= 1, 'own insertion records are discarded');
    let inserted = 1;
    for (let i = 0; i < 40; i++) {
      e.base.querySelector('.bkc-embed-actions')?.remove(); f.observers[0].callback(); await Promise.resolve();
      if (e.base.querySelector('.bkc-open-board')) inserted++;
    }
    assert.ok(inserted < 25, `refresh halted after repeated changes (${inserted})`);
    f.manager.wake(); await Promise.resolve();
    assert.equal(e.base.querySelectorAll('.bkc-open-board').length, 1);
  } finally { console.warn = warn; }
});
