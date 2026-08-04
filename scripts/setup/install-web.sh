#!/usr/bin/env bash
set -euo pipefail

# single root workspace install — the root lockfile is authoritative.
#
# android (termux) needs no special flags: `.npmrc` (`android_ndk_path`)
# lets re2 build natively with the termux clang toolchain, and `libsql` /
# `@libsql/android-arm64` are substituted via the root package.json overrides.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "→ root workspace"
(cd "$ROOT" && npm install)
echo "→ build @phantom/extractors"
(cd "$ROOT/packages/extractors" && npm run build)
echo "✅ web deps installed"
