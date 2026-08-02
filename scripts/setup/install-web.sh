#!/usr/bin/env bash
set -euo pipefail

# single root workspace install — the root lockfile is authoritative.
#
# termux backend needs 2 android-only workarounds:
#   --force          libsql declares os darwin,linux,win32 → EBADPLATFORM. mocked at runtime.
#   --ignore-scripts re2 (+ other native addons) has no android prebuilt & no NDK to build;
#                    url-regex-safe falls back to RegExp, so app boots fine without it.
# detect via process.platform, not uname — uname reports GNU/Linux on termux, npm doesn't.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

backend_flags=""
if node -e 'process.exit(process.platform === "android" ? 0 : 1)' 2>/dev/null; then
  backend_flags="--force --ignore-scripts"
fi

echo "→ root workspace"
(cd "$ROOT" && npm install $backend_flags)
echo "→ build @phantom/extractors"
(cd "$ROOT/packages/extractors" && npm run build)
echo "✅ web deps installed"
