#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

// termux bins carry a shebang the bionic loader can't run, so tsc is
// always exec'd via node against each workspace's own resolved copy
const WORKSPACES = [
  'web/backend',
  'web/frontend',
  'mobile',
  'packages/extractors',
  'packages/web-mux',
];

const root = path.resolve(import.meta.dirname, '..');
let failed = 0;

for (const ws of WORKSPACES) {
  const dir = path.join(root, ws);
  const require = createRequire(path.join(dir, 'package.json'));
  let tsc;
  try {
    tsc = require.resolve('typescript/bin/tsc');
  } catch {
    console.error(`✗ ${ws}: typescript not installed`);
    failed++;
    continue;
  }
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', dir], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`✗ ${ws} (ts ${require('typescript/package.json').version})`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    failed++;
  } else {
    console.log(`✓ ${ws} (ts ${require('typescript/package.json').version})`);
  }
}

// astro's compiler has no usable android binding (native stub missing,
// wasi sandbox hits UVWASI_EACCES on termux) — checked in CI instead
if (process.platform !== 'android') {
  const siteDir = path.join(root, 'web/site');
  const astro = path.join(root, 'node_modules/astro/bin/astro.mjs');
  // check needs generated content types first
  spawnSync(process.execPath, [astro, 'sync'], { cwd: siteDir });
  const r = spawnSync(
    process.execPath,
    [astro, 'check'],
    { cwd: siteDir, encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.error('✗ web/site (astro check)');
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    failed++;
  } else {
    console.log('✓ web/site (astro check)');
  }
}

if (failed) {
  console.error(`✅✗ typecheck: ${failed} workspace(s) failed`);
  process.exit(1);
}
console.log('✅ typecheck passed (all workspaces)');