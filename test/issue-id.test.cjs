const test = require('node:test');
const assert = require('node:assert/strict');
const { nextIssue, mergeCounters } = require('../src/issue-id.cjs');

test('issue numbers are independent per project and consider archived or moved existing IDs', () => {
  assert.deepEqual(nextIssue('GRID', {}, []), { id: 'GRID-1', number: 1 });
  assert.equal(nextIssue('GRID', { GRID: 7, OTHER: 99 }, [{ issue_id: 'GRID-9' }, { issue_id: 'OTHER-100' }]).id, 'GRID-10');
  assert.equal(nextIssue('OTHER', { GRID: 7 }, [{ issue_id: 'GRID-9' }]).id, 'OTHER-1');
  assert.equal(nextIssue('GRID', { GRID: 7 }, []).id, 'GRID-8');
  assert.equal(nextIssue('GRID', {}, [{ issue_id: 'GRID-1' }, { issue_id: 'GRID-4' }, { issue_id: 'GRID-4' }]).id, 'GRID-5');
});

test('settings imports and stale drafts cannot lower or discard existing high-water marks', () => {
  assert.deepEqual(mergeCounters({ GRID: 7, OLD: 5 }, { GRID: 1, NEW: 2 }), { GRID: 7, OLD: 5, NEW: 2 });
});

test('invalid names, exhausted counters and unsafe matching IDs fail closed', () => {
  for (const project of ['grid', 'GRID APP', '그리드', 'GRID1']) assert.throws(() => nextIssue(project, {}, []), /English|uppercase/i);
  assert.throws(() => nextIssue('GRID', { GRID: Number.MAX_SAFE_INTEGER }, []), /exhausted/i);
  assert.throws(() => nextIssue('GRID', {}, [{ issue_id: 'GRID-9007199254740992' }]), /safe|range/i);
  for (const id of [null, 1, 'GRID-0', 'GRID-1x', 'NOT-GRID-9', 'GRID-01']) assert.equal(nextIssue('GRID', {}, [{ issue_id: id }]).id, 'GRID-1');
});
