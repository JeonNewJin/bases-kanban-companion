const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSettings, DEFAULT_SETTINGS } = require('../src/core.cjs');
const { Router } = require('../src/router.cjs');

function fixture() {
  const settings = validateSettings({ ...DEFAULT_SETTINGS, projects: [{ name: 'EXAMPLE', enabled: true,
    newTaskFolder: 'Tasks/Active', routes: [{ status: 'Doing', folder: 'Tasks/Active' }, { status: 'Done', folder: 'Tasks/Archive' }] }] });
  const file = { path: 'Tasks/Active/Task.md', name: 'Task.md', extension: 'md', parent: { path: 'Tasks/Active' } };
  let fm = { project: 'EXAMPLE', type: 'task', status: 'Done' };
  const entries = new Map([[file.path, file]]);
  const moves = [], notices = [];
  const io = {
    fileAt: path => entries.get(path), metadata: () => fm,
    ensureFolder: async () => {},
    rename: async (note, target) => {
      assert.equal(entries.has(target), false);
      moves.push([note.path, target]); entries.delete(note.path);
      note.path = target; note.parent = { path: target.slice(0, target.lastIndexOf('/')) }; entries.set(target, note);
    }, notice: text => notices.push(text)
  };
  const router = new Router(io, () => settings);
  return { router, settings, file, io, moves, entries, notices, setStatus: status => { fm = { ...fm, status }; } };
}

test('serialized events move once and reopening restores the same file', async () => {
  const f = fixture();
  f.router.enqueue(f.file); f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.moves.length, 1); assert.equal(f.file.path, 'Tasks/Archive/Task.md');
  f.setStatus('Doing'); f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.file.path, 'Tasks/Active/Task.md'); assert.equal(f.moves.length, 2);
});

test('conflicts do not overwrite notes and repeated events show only one notice', async () => {
  const f = fixture();
  f.entries.set('Tasks/Archive/Task.md', {});
  f.router.enqueue(f.file); f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.moves.length, 0); assert.equal(f.notices.length, 1);
});

test('deleted notes, non-Markdown files, and unloaded routers are ignored', async () => {
  const f = fixture();
  f.entries.delete(f.file.path); f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.moves.length, 0);
  f.entries.set(f.file.path, f.file); f.file.extension = 'base';
  f.router.enqueue(f.file); await f.router.queue; assert.equal(f.moves.length, 0);
  f.file.extension = 'md'; f.router.enqueue(f.file); f.router.stop(); await f.router.queue;
  assert.equal(f.moves.length, 0);
});

test('a status change while creating the destination folder prevents a stale move', async () => {
  const f = fixture();
  f.io.ensureFolder = async () => { f.setStatus('Doing'); };
  f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.moves.length, 0);
});

test('settings changes and unloading during folder creation cancel the move', async () => {
  for (const change of [f => { f.settings.projects[0].enabled = false; }, f => f.router.stop()]) {
    const f = fixture(); f.io.ensureFolder = async () => change(f);
    f.router.enqueue(f.file); await f.router.queue; assert.equal(f.moves.length, 0);
  }
});

test('a collision appearing during folder creation is also preserved', async () => {
  const f = fixture(); f.io.ensureFolder = async () => f.entries.set('Tasks/Archive/Task.md', {});
  f.router.enqueue(f.file); await f.router.queue;
  assert.equal(f.moves.length, 0); assert.equal(f.notices.length, 1);
});

test('one failing move does not stop the queue and preview does not mutate files', async () => {
  const f = fixture();
  assert.deepEqual(f.router.preview([f.file]), [{ file: f.file, source: f.file.path, target: 'Tasks/Archive/Task.md', conflict: false }]);
  assert.equal(f.moves.length, 0);
  f.io.rename = async () => { throw new Error('Permission denied'); };
  f.router.enqueue(f.file); await f.router.queue; assert.match(f.notices[0], /Permission denied/);
  f.io.rename = async () => f.moves.push('ok');
  f.router.enqueue(f.file); await f.router.queue; assert.deepEqual(f.moves, ['ok']);
});
