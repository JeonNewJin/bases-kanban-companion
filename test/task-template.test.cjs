const test = require('node:test');
const assert = require('node:assert/strict');
const { templateMatches, taskFromTemplate } = require('../src/task-template.cjs');

const info = content => {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? { exists: true, frontmatter: match[1], contentStart: match[0].length }
    : { exists: false, contentStart: 0 };
};
const api = {
  getFrontMatterInfo: info, parseYaml: text => text.trim() ? JSON.parse(text) : null,
  stringifyYaml: JSON.stringify,
  now: { format: format => ({ 'YYYY-MM-DD': '2026-10-05', 'HH:mm': '09:30', 'YYYY/MM/DD': '2026/10/05' }[format] || format) }
};
const template = (fm, body) => '---\n' + JSON.stringify(fm) + '\n---\n' + body;
const parse = content => JSON.parse(info(content).frontmatter);

test('template candidates are Markdown files in the selected folder or descendants, never hidden paths', () => {
  assert.equal(templateMatches('Templates/Task.md', 'Templates'), true);
  assert.equal(templateMatches('Templates/Tasks/Feature.md', 'Templates'), true);
  assert.equal(templateMatches('Notes/Example.md', ''), true);
  for (const path of ['Templates2/Task.md', 'Templates/Board.base', 'Templates/.secret.md', '.obsidian/template.md', '../Task.md', '/Templates/Task.md']) {
    assert.equal(templateMatches(path, 'Templates'), false);
    if (path.startsWith('.') || path.startsWith('/')) assert.equal(templateMatches(path, ''), false);
  }
});

test('template creation keeps body, links and extra properties while explicit task metadata wins', () => {
  const source = template({ up: ['[[Parent]]'], project: 'Other', type: 'feature', status: 'Done', priority: 'Low', part: 'FE' }, '\n## Purpose\n\n![[Children.base]]\n\n- [ ] Keep this\n');
  const before = source;
  const result = taskFromTemplate(source, 'Feature', { project: 'Example', status: 'To do', priority: 'High' }, api);
  assert.deepEqual(parse(result), { up: ['[[Parent]]'], project: 'Example', type: 'feature', status: 'To do', priority: 'High', part: 'FE' });
  assert.equal(result.slice(info(result).contentStart), '\n## Purpose\n\n![[Children.base]]\n\n- [ ] Keep this\n');
  assert.equal(source, before);
});

test('standard variables render in body and parsed property values without YAML injection or double expansion', () => {
  const title = 'Feature "quoted" {{date}}';
  const source = template({ aliases: ['{{title}}'], created: '{{date}}', nested: { time: '{{time}}' }, unknown: '{{custom}}' }, '# {{title}}\n{{date:YYYY/MM/DD}} {{time}} {{custom}} {{title:ignored}}');
  const result = taskFromTemplate(source, title, { project: 'Example' }, api);
  assert.deepEqual(parse(result), { aliases: [title], created: '2026-10-05', nested: { time: '09:30' }, unknown: '{{custom}}', project: 'Example' });
  assert.equal(result.slice(info(result).contentStart), '# ' + title + '\n2026/10/05 09:30 {{custom}} {{title:ignored}}');
});

test('body-only, empty-frontmatter and CRLF templates are accepted without inserting a second frontmatter', () => {
  for (const source of ['# {{title}}\n- [ ] ', '---\n\n---\n# {{title}}\n- [ ] ', '\uFEFF---\r\n{}\r\n---\r\n# {{title}}\r\n- [ ] ']) {
    const result = taskFromTemplate(source, 'A task', { project: 'Example' }, api);
    assert.deepEqual(parse(result), { project: 'Example' });
    assert.ok(result.includes('# A task'));
    assert.equal((result.match(/^---$/gm) || []).length, 2);
  }
});

test('malformed, non-map, unsafe and scripted templates fail before a note can be created', () => {
  for (const fm of ['invalid yaml', 'null', '[]', '"string"', '42', '{"__proto__":{"polluted":true}}', '{"nested":{"constructor":"bad"}}']) {
    assert.throws(() => taskFromTemplate('---\n' + fm + '\n---\nBody', 'Task', {}, api), /frontmatter|property|JSON|Unexpected/i);
  }
  assert.throws(() => taskFromTemplate('---\nproject: Example\nBody without a closing delimiter', 'Task', {}, api), /frontmatter/i);
  assert.throws(() => taskFromTemplate('<% tp.file.title %>', 'Task', {}, api), /Templater/);
  const cycle = {}; cycle.loop = cycle;
  assert.throws(() => taskFromTemplate(template({}, 'Body'), 'Task', {}, { ...api, parseYaml: () => cycle }), /recursive|nested/i);
  assert.equal({}.polluted, undefined);
});
