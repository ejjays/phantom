import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.binding-fix-tmp');

// npm drops android optional deps silently; walk node_modules trees (scoped +
// nested) and place each binding beside every real copy of its consumer
function findPackageDirs(name) {
  const hits = [];
  const visitNm = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const full = join(dir, ent.name);
      if (ent.name.startsWith('@')) {
        let subs;
        try {
          subs = readdirSync(full, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const sub of subs) {
          if (!sub.isDirectory()) continue;
          if (`${ent.name}/${sub.name}` === name) hits.push(join(full, sub.name));
          else visitNested(join(full, sub.name), depth);
        }
      } else if (ent.name === name) {
        hits.push(full);
      } else {
        visitNested(full, depth);
      }
    }
  };
  const visitNested = (pkgDir, depth) => {
    if (depth >= 4) return;
    visitNm(join(pkgDir, 'node_modules'), depth + 1);
  };
  visitNm(join(root, '..', '..', 'node_modules'), 0);
  visitNm(join(root, 'node_modules'), 0);
  return [...new Set(hits)];
}

function readVersion(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
}

function fetchTarball(name, version) {
  mkdirSync(tmp, { recursive: true });
  rmSync(join(tmp, 'package'), { recursive: true, force: true });
  execFileSync('npm', ['pack', `${name}@${version}`, '--silent'], { cwd: tmp, stdio: 'pipe' });
  const tarball = join(tmp, `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`);
  execFileSync('tar', ['-xzf', tarball, '-C', tmp]);
  rmSync(tarball);
  return join(tmp, 'package');
}

const packCache = new Map();
function pack(name, version) {
  const key = `${name}@${version}`;
  if (!packCache.has(key)) packCache.set(key, fetchTarball(name, version));
  return packCache.get(key);
}

const JOBS = [
  {
    label: '@tailwindcss/oxide-android-arm64',
    done: () => {
      const dirs = findPackageDirs('@tailwindcss/oxide');
      return dirs.length > 0 && dirs.every((d) => existsSync(join(dirname(d), 'oxide-android-arm64', 'package.json')));
    },
    install: () => {
      for (const dir of findPackageDirs('@tailwindcss/oxide')) {
        cpSync(pack('@tailwindcss/oxide-android-arm64', readVersion(dir)), join(dirname(dir), 'oxide-android-arm64'), {
          recursive: true,
        });
      }
    },
  },
  {
    label: '@rolldown/binding-android-arm64',
    done: () => {
      const dirs = findPackageDirs('rolldown');
      return (
        dirs.length > 0 &&
        dirs.every((d) => existsSync(join(dirname(d), '@rolldown', 'binding-android-arm64', 'package.json')))
      );
    },
    install: () => {
      for (const dir of findPackageDirs('rolldown')) {
        cpSync(
          pack('@rolldown/binding-android-arm64', readVersion(dir)),
          join(dirname(dir), '@rolldown', 'binding-android-arm64'),
          { recursive: true }
        );
      }
    },
  },
  {
    label: '@esbuild/android-arm64',
    done: () => {
      // termux node reports platform "android"; npm only drops optional deps here
      if (process.platform !== 'android') return true;
      const dirs = findPackageDirs('esbuild');
      return (
        dirs.length > 0 && dirs.every((d) => existsSync(join(dirname(d), '@esbuild', 'android-arm64', 'package.json')))
      );
    },
    install: () => {
      for (const dir of findPackageDirs('esbuild')) {
        cpSync(pack('@esbuild/android-arm64', readVersion(dir)), join(dirname(dir), '@esbuild', 'android-arm64'), {
          recursive: true,
        });
      }
    },
  },
  {
    label: 'lightningcss.android-arm64.node',
    done: () => {
      const dirs = findPackageDirs('lightningcss');
      return dirs.length > 0 && dirs.every((d) => existsSync(join(d, 'lightningcss.android-arm64.node')));
    },
    install: () => {
      // copies can pin different lightningcss versions, each needs a matching abi
      for (const dir of findPackageDirs('lightningcss')) {
        const extracted = pack('lightningcss-android-arm64', readVersion(dir));
        cpSync(join(extracted, 'lightningcss.android-arm64.node'), join(dir, 'lightningcss.android-arm64.node'));
      }
    },
  },
];

let missing = false;
try {
  for (const job of JOBS) {
    if (job.done()) continue;
    missing = true;
    console.log(`[binding-fix] restoring ${job.label}`);
    job.install();
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (!missing) {
  console.log('[binding-fix] all native bindings present');
}
