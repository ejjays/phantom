import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const tmp = join(root, '.binding-fix-tmp');

const JOBS = [
  {
    // no android-arm64 binding published; wasm fallback keeps astro building on termux
    name: '@astrojs/compiler-binding-wasm32-wasi',
    version: '0.3.2',
    done: () => {
      try {
        require_('@astrojs/compiler-binding-wasm32-wasi');
        return true;
      } catch {
        return false;
      }
    },
    install: (extracted) => {
      const targets = [
        join(root, '..', '..', 'node_modules', '@astrojs', 'compiler-binding-wasm32-wasi'),
        join(root, 'node_modules', '@astrojs', 'compiler-binding-wasm32-wasi'),
      ];
      for (const dest of targets) {
        cpSync(extracted, dest, { recursive: true });
        // android blocks uvwasi preopen of '/'; map wasi root to cwd instead
        const wasiLoader = join(dest, 'astro.wasi.cjs');
        if (existsSync(wasiLoader)) {
          const src = readFileSync(wasiLoader, 'utf8');
          const patched = src.replace(
            "const __rootDir = __nodePath.parse(process.cwd()).root",
            'const __rootDir = process.cwd()',
          );
          if (patched !== src) writeFileSync(wasiLoader, patched);
        }
      }
    },
  },
  {
    name: '@tailwindcss/oxide-android-arm64',
    version: '4.3.3',
    done: () => {
      try {
        require_('@tailwindcss/oxide');
        return true;
      } catch {
        return false;
      }
    },
    install: (extracted) =>
      cpSync(extracted, join(root, 'node_modules', '@tailwindcss', 'oxide-android-arm64'), {
        recursive: true,
      }),
  },
  {
    name: '@rolldown/binding-android-arm64',
    version: '1.2.5',
    done: () => {
      try {
        require_('@rolldown/binding-android-arm64');
        return true;
      } catch {
        return false;
      }
    },
    install: (extracted) =>
      cpSync(extracted, join(root, 'node_modules', '@rolldown', 'binding-android-arm64'), {
        recursive: true,
      }),
  },
  {
    name: 'lightningcss-android-arm64',
    version: '1.33.0',
    done: () =>
      existsSync(join(root, 'node_modules', 'lightningcss', 'lightningcss.android-arm64.node')) &&
      existsSync(
        join(root, 'node_modules', '@tailwindcss/node/node_modules/lightningcss', 'lightningcss.android-arm64.node')
      ),
    install: (extracted) => {
      cpSync(
        join(extracted, 'lightningcss.android-arm64.node'),
        join(root, 'node_modules', 'lightningcss', 'lightningcss.android-arm64.node')
      );
      const nested = join(root, 'node_modules', '@tailwindcss/node/node_modules/lightningcss');
      if (existsSync(nested)) {
        cpSync(join(extracted, 'lightningcss.android-arm64.node'), join(nested, 'lightningcss.android-arm64.node'));
      }
    },
  },
];

function fetchTarball(name, version) {
  mkdirSync(tmp, { recursive: true });
  execFileSync('npm', ['pack', `${name}@${version}`, '--silent'], { cwd: tmp, stdio: 'pipe' });
  const tarball = join(tmp, `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`);
  execFileSync('tar', ['-xzf', tarball, '-C', tmp]);
  rmSync(tarball);
  return join(tmp, 'package');
}

let missing = false;
for (const job of JOBS) {
  if (job.done()) continue;
  missing = true;
  console.log(`[binding-fix] restoring ${job.name}@${job.version}`);
  try {
    job.install(fetchTarball(job.name, job.version));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!missing) {
  console.log('[binding-fix] all native bindings present');
}
