const test = require('node:test');
const assert = require('node:assert/strict');
const { RenderScheduler, CHURN_LIMIT } = require('../src/render-scheduler.cjs');

test('refreshes wait for the next animation frame and coalesce', () => {
  const frames = []; let runs = 0;
  const scheduler = new RenderScheduler(() => { runs++; }, 'test');
  scheduler.win = { requestAnimationFrame(callback) { assert.equal(this, scheduler.win); frames.push(callback); } };
  scheduler.schedule(); scheduler.schedule();
  assert.equal(frames.length, 1); assert.equal(runs, 0);
  frames[0](); assert.equal(runs, 1);
  scheduler.schedule(); assert.equal(frames.length, 2);
});

test('falls back to a microtask without a window or after its window closed', async () => {
  let runs = 0; const scheduler = new RenderScheduler(() => { runs++; }, 'test');
  scheduler.schedule(); assert.equal(runs, 0); await Promise.resolve(); assert.equal(runs, 1);
  scheduler.win = { closed: true, requestAnimationFrame: () => assert.fail('closed window frame') };
  scheduler.schedule(); await Promise.resolve(); assert.equal(runs, 2);
});

test('a refresh loop that keeps changing the DOM halts until woken', async () => {
  const warn = console.warn; const warnings = []; console.warn = text => warnings.push(text);
  try {
    let runs = 0; const scheduler = new RenderScheduler(() => { runs++; }, 'test');
    for (let i = 1; i < CHURN_LIMIT; i++) assert.equal(scheduler.settle(true), true);
    assert.equal(scheduler.settle(true), false); assert.equal(scheduler.settle(true), false);
    assert.equal(warnings.length, 1);
    scheduler.schedule(); await Promise.resolve(); assert.equal(runs, 0);
    scheduler.wake(); await Promise.resolve(); assert.equal(runs, 1);
    for (let i = 1; i < CHURN_LIMIT; i++) scheduler.settle(true);
    assert.equal(scheduler.settle(false), true); assert.equal(scheduler.settle(true), true);
  } finally { console.warn = warn; }
});
