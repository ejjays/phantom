#!/bin/bash
# Sequential test runner for low-memory environments (Termux)
# Runs each test file in isolation, freeing memory between them.
# Usage: ./scripts/test-sequential.sh [pattern]

set -e

cd "$(dirname "$0")/.."

PATTERN="${1:-tests/core/*.test.ts tests/api/*.test.ts}"
PASS=0
FAIL=0
FAILED_FILES=()

# expand glob pattern
shopt -s nullglob
FILES=()
for pat in $PATTERN; do
  for file in $pat; do
    [ -f "$file" ] && FILES+=("$file")
  done
done

TOTAL=${#FILES[@]}
echo "Running $TOTAL test files sequentially..."
echo ""

for i in "${!FILES[@]}"; do
  FILE="${FILES[$i]}"
  IDX=$((i + 1))
  printf "[%d/%d] %s ... " "$IDX" "$TOTAL" "$FILE"

  if NODE_ENV=test NODE_OPTIONS='--import ./scripts/termux-shim.js --max-old-space-size=384' \
     npx vitest run "$FILE" --reporter=dot --no-coverage > /tmp/vitest-out.log 2>&1; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    FAILED_FILES+=("$FILE")
    tail -20 /tmp/vitest-out.log
  fi

  # let the OS reclaim memory between runs
  sleep 1
done

echo ""
echo "=========================================="
echo "Total: $TOTAL | Passed: $PASS | Failed: $FAIL"
echo "=========================================="

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  echo ""
  echo "Failed files:"
  printf '  %s\n' "${FAILED_FILES[@]}"
  exit 1
fi
