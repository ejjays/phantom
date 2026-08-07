#!/bin/bash
# one-shot knip installer for termux (arm64)
# runs knip through official glibc node — android's bionic node can't load oxc-resolver
# safe to re-run: skips steps already done

set -euo pipefail

ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "only arm64 phones are supported (yours: $ARCH)"
  exit 1
fi

NODE_VERSION="${KNIP_NODE_VERSION:-24.18.0}"
BASE="${KNIP_BASE:-$HOME/.glibc-node}"
PREFIX="$(dirname "$(dirname "$(command -v bash)")")"
LD="$PREFIX/glibc/lib/ld-linux-aarch64.so.1"

echo "==> step 1/4: termux glibc layer (one-time)"
pkg install -y glibc-repo >/dev/null 2>&1 || true
pkg update >/dev/null 2>&1 || true
pkg install -y glibc xz-utils >/dev/null
[ -x "$LD" ] || { echo "glibc loader missing at $LD"; exit 1; }

mkdir -p "$BASE"

echo "==> step 2/4: official node v$NODE_VERSION (~30MB download)"
if [ ! -x "$BASE/node/bin/node" ]; then
  TARBALL="node-v$NODE_VERSION-linux-arm64.tar.xz"
  curl -fsSL -o "$BASE/$TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
  tar -xJf "$BASE/$TARBALL" -C "$BASE"
  mv "$BASE/node-v$NODE_VERSION-linux-arm64" "$BASE/node"
  rm "$BASE/$TARBALL"
fi
NODE="$BASE/node/bin/node"

echo "==> step 3/4: verify glibc node"
"$LD" --library-path "$PREFIX/glibc/lib" "$NODE" -e \
  "const r=process.report.getReport().header; if(!r.glibcVersionRuntime) throw new Error('glibc runtime missing'); console.log('node', process.version, 'ok (glibc', r.glibcVersionRuntime+')')"

echo "==> step 4/4: install knip"
if [ ! -d "$BASE/knip/node_modules" ]; then
  mkdir -p "$BASE/knip"
  "$LD" --library-path "$PREFIX/glibc/lib" "$NODE" \
    "$BASE/node/lib/node_modules/npm/bin/npm-cli.js" --prefix "$BASE/knip" install knip >/dev/null
fi

mkdir -p "$HOME/bin"
cat > "$HOME/bin/knip" <<EOF
#!$PREFIX/bin/bash
exec "$LD" --library-path "$PREFIX/glibc/lib" "$NODE" "$BASE/knip/node_modules/knip/bin/knip.js" "\$@"
EOF
chmod +x "$HOME/bin/knip"

echo "==> verify"
"$HOME/bin/knip" --version

echo
echo "done. from any project folder run:  knip"
case ":$PATH:" in
  *":$HOME/bin:"*) ;;
  *) echo "add ~/bin to PATH once:  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc" ;;
esac
