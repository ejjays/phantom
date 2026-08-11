#!/usr/bin/env bash
if grep -rE '"@[^"]+/binding-(android|darwin|linux|win32|freebsd|s390x|ppc64|openharmony)' \
  --include package.json --exclude-dir node_modules --exclude-dir .git .; then
  echo "stray platform binding pinned in a package.json — remove it (AGENTS.md Gotchas)"
  exit 1
fi