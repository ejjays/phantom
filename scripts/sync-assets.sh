#!/usr/bin/env bash
# syncs canonical assets from mobile/ -> web/site/public/ (mobile is source of truth)
# add/update only, never deletes site-only extras like pinterest.svg
# usage: bash scripts/sync-assets.sh [--check]
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

sync() { # <src> <dst>
  if [ ! -f "$1" ]; then
    echo "missing: $1" >&2
    return 1
  fi
  if [ -f "$2" ] && cmp -s "$1" "$2"; then
    [ "$CHECK" = 1 ] || true
    return 0
  fi
  if [ "$CHECK" = 1 ]; then
    echo "drift: $2"
    return 1
  fi
  cp "$1" "$2"
  echo "copied: $2"
}

for f in mobile/assets/screenshots/*.webp; do
  sync "$f" "web/site/public/screenshots/${f##*/}"
done

for f in mobile/assets/logos/_src/*.svg; do
  sync "$f" "web/site/public/logos/${f##*/}"
done

sync mobile/assets/adaptive-icon.png web/site/public/brand/icon.png

echo "done: mobile assets -> web/site/public"
