const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');
const versions = require('../versions.json');
assert.match(manifest.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.equal(manifest.id.includes('obsidian'), false);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, require('../package.json').version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.equal(manifest.author, 'wjsyuwls');
assert.equal(manifest.isDesktopOnly, true, 'The first release is desktop-only until mobile QA is complete.');
const bundle = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const imports = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]);
assert.deepEqual([...new Set(imports)], ['obsidian']);
for (const marker of ['/Users/', 'Efforts/On', 'Efforts/Archive', 'GRID', 'fetch(', 'XMLHttpRequest']) assert.equal(bundle.includes(marker), false, marker);
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), fs.readFileSync(path.join(root, 'release', file), 'utf8'));
}
assert.ok(!fs.existsSync(path.join(root, 'release', 'data.json')));
console.log('Release metadata, assets, and runtime imports checked.');
