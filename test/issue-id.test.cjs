const test = require('node:test');
const assert = require('node:assert/strict');
const { nextIssue, mergeCounters } = require('../src/issue-id.cjs');

test('issue numbers are independent per project and consider archived or moved existing IDs', () => {
  assert.deepEqual(nextIssue('EXAMPLE', {}, []), { id: 'EXAMPLE-1', number: 1 });
  assert.equal(nextIssue('EXAMPLE', { EXAMPLE: 7, OTHER: 99 }, [{ issue_id: 'EXAMPLE-9' }, { issue_id: 'OTHER-100' }]).id, 'EXAMPLE-10');
  assert.equal(nextIssue('OTHER', { EXAMPLE: 7 }, [{ issue_id: 'EXAMPLE-9' }]).id, 'OTHER-1');
  assert.equal(nextIssue('EXAMPLE', { EXAMPLE: 7 }, []).id, 'EXAMPLE-8');
  assert.equal(nextIssue('EXAMPLE', {}, [{ issue_id: 'EXAMPLE-1' }, { issue_id: 'EXAMPLE-4' }, { issue_id: 'EXAMPLE-4' }]).id, 'EXAMPLE-5');
});

test('settings imports and stale drafts cannot lower or discard existing high-water marks', () => {
  assert.deepEqual(mergeCounters({ EXAMPLE: 7, OLD: 5 }, { EXAMPLE: 1, NEW: 2 }), { EXAMPLE: 7, OLD: 5, NEW: 2 });
});

test('invalid names, exhausted counters and unsafe matching IDs fail closed', () => {
  for (const project of ['example', 'EXAMPLE APP', 'PROJÉT', 'EXAMPLE1']) assert.throws(() => nextIssue(project, {}, []), /English|uppercase/i);
  assert.throws(() => nextIssue('EXAMPLE', { EXAMPLE: Number.MAX_SAFE_INTEGER }, []), /exhausted/i);
  assert.throws(() => nextIssue('EXAMPLE', {}, [{ issue_id: 'EXAMPLE-9007199254740992' }]), /safe|range/i);
  for (const id of [null, 1, 'EXAMPLE-0', 'EXAMPLE-1x', 'NOT-EXAMPLE-9', 'EXAMPLE-01']) assert.equal(nextIssue('EXAMPLE', {}, [{ issue_id: id }]).id, 'EXAMPLE-1');
});
