'use strict';

const { projectName, validateCounters } = require('./core.cjs');

function mergeCounters(current, incoming) {
  const result = { ...validateCounters(current) };
  for (const [project, number] of Object.entries(validateCounters(incoming))) result[project] = Math.max(result[project] || 0, number);
  return result;
}

function nextIssue(project, counters, frontmatters) {
  if (projectName(project) !== project) throw new Error('Save an uppercase English project name before creating issues.');
  let highest = validateCounters(counters)[project] || 0;
  const pattern = new RegExp('^' + project + '-([1-9][0-9]*)$');
  for (const fm of frontmatters) {
    if (typeof fm?.issue_id !== 'string') continue;
    const match = fm.issue_id.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number)) throw new Error('Existing issue identifier is outside the safe number range: ' + fm.issue_id);
    highest = Math.max(highest, number);
  }
  if (highest >= Number.MAX_SAFE_INTEGER) throw new Error('Issue number range exhausted for ' + project + '.');
  return { id: project + '-' + (highest + 1), number: highest + 1 };
}

module.exports = { nextIssue, mergeCounters };
