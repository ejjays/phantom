#!/usr/bin/env node
// no official ts7 android pkg — place linux-arm64 build under the name tsgo's launcher expects
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

if (process.platform !== 'android') process.exit(0);

const root = resolve(dirname(import.meta.filename), '..');
const require = createRequire(join(root, 'package.json'));

let version;
try {
  version = require('typescript7/package.json').version;
} catch {
  process.exit(0);
}

const target = join(root, 'node_modules', '@typescript', 'typescript-android-arm64');
const marker = join(target, '.placed-by-fix-ts7');
if (existsSync(marker)) process.exit(0);

console.log(`[fix-ts7] placing linux-arm64 tsc ${version} as android-arm64`);
const tmp = join(root, 'node_modules', '.ts7-tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

try {
  execFileSync('npm', [
    'pack', `@typescript/typescript-linux-arm64@${version}`, '--pack-destination', tmp,
  ], { stdio: 'pipe' });
  const tarball = join(tmp, `typescript-typescript-linux-arm64-${version}.tgz`);
  execFileSync('tar', ['-xzf', tarball, '-C', tmp]);
  rmSync(tarball);

  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(join(tmp, 'package'), target, { recursive: true });

  const pkgPath = join(target, 'package.json');
  const pkg = require(pkgPath);
  pkg.name = '@typescript/typescript-android-arm64';
  pkg.version = version;
  delete pkg.os;
  delete pkg.cpu;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  chmodSync(join(target, 'lib', 'tsc'), 0o755);
  writeFileSync(marker, '');
  console.log('[fix-ts7] done');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
