#!/usr/bin/env bash
# astro dev launcher — termux phones run astro under glibc node via proot
set -euo pipefail
cd "$(dirname "$0")/../web/site"

GLIBC_NODE="$HOME/.glibc-node/node/bin/node"
LD="$PREFIX/glibc/lib/ld-linux-aarch64.so.1"

if [ -x "$GLIBC_NODE" ] && [ -x "$LD" ] && command -v proot >/dev/null; then
  node scripts/binding-fix.mjs
  # termux's bionic ld-preload shim crashes glibc node
  unset LD_PRELOAD
  exec proot \
    -b "$LD:/lib/ld-linux-aarch64.so.1" \
    -b "$PREFIX/glibc/lib:/lib" \
    -b "$PREFIX/glibc/lib:/usr/lib" \
    "$GLIBC_NODE" --require ./userland-shim.cjs ../../node_modules/astro/bin/astro.mjs dev --host "$@"
fi

if [ "$(uname -o)" = "Android" ]; then
  echo "astro needs glibc node + proot on termux — install via: bash scripts/knip-termux.sh && pkg install proot" >&2
  exit 1
fi

exec node --require ./userland-shim.cjs ../../node_modules/astro/bin/astro.mjs dev --host "$@"
