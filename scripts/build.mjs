import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error('Package and manifest versions must match.');
await build({
  absWorkingDir: root, entryPoints: ['src/main.cjs'], bundle: true, external: ['obsidian'],
  platform: 'browser', format: 'cjs', target: 'es2020', outfile: path.join(root, 'main.js'),
  sourcemap: false, minify: false, legalComments: 'inline'
});
const release = path.join(root, 'release');
await mkdir(release, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(path.join(root, file), path.join(release, file));
console.log('Built release assets in release/. Nothing was published.');
