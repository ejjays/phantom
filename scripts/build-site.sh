#!/usr/bin/env bash
# build merged site: astro landing + spa under /app/ into web/site/dist
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

echo '[site] building astro...'
(cd "$root/web/site" && node ../../node_modules/astro/bin/astro.mjs build)

echo '[app] building spa...'
(cd "$root/web/frontend" && node ../../node_modules/vite/bin/vite.js build)

echo '[merge] spa -> dist/app'
rm -rf "$root/web/site/dist/app"
cp -r "$root/web/frontend/dist" "$root/web/site/dist/app"

echo "done: $root/web/site/dist"
