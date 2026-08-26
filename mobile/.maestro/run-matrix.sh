#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO="${MAESTRO_BIN:-$HOME/.maestro/maestro/bin/maestro}"
APP_ID="com.phantom.app"
ART="${ART_DIR:-$GITHUB_WORKSPACE/maestro-artifacts}"
TIER_MODE="${TIER_MODE:-solid}"
DISPATCH_URL="${DISPATCH_URL:-}"
mkdir -p "$ART"

restart_app() {
  adb shell am force-stop "$APP_ID" 2>/dev/null
  sleep 2
  adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 5
}

mtest() {
  local phase=$1 dir=$2 flow=$3 timeout_s=$4
  MAESTRO_CLI_NO_ANALYTICS=1 timeout -k 10 "$timeout_s" "$MAESTRO" test \
    --debug-output "$dir" \
    "$flow"
}

CASES=$(mktemp)
if [ -n "$DISPATCH_URL" ]; then
  printf '{"id":"custom","tier":"solid","url":"%s","expect":{"minFormats":1}}\n' "$DISPATCH_URL" > "$CASES"
else
  jq -c --arg m "$TIER_MODE" 'select(.tier == $m or $m == "all")' "$ROOT/e2e-cases.json" > "$CASES"
fi

total=$(wc -l < "$CASES")
echo "MATRIX: tier=$TIER_MODE cases=$total"
solid_fails=0
soft_fails=0
failed_ids=""

while IFS= read -r case_json; do
  [ -z "$case_json" ] && continue
  id=$(printf '%s' "$case_json" | jq -r .id)
  url=$(printf '%s' "$case_json" | jq -r .url)
  tier=$(printf '%s' "$case_json" | jq -r .tier)
  base=$(adb logcat -d 2>/dev/null | grep -c 'E2E_META' || true)
  echo "=== CASE $id [$tier] $url ==="
  verdict="ok"

  if ! mtest focus "$ART/$id-focus" "$ROOT/open-input.yaml" 300; then
    verdict="focus"
  else
    adb shell input text "xxxx" 2>/dev/null
    adb shell input keyevent 67 67 67 67
    for c in $(printf '%s' "$url" | grep -o .); do
      adb shell input text "$c"
      sleep 0.35
    done
    timeout 20 adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
    adb pull /sdcard/ui.xml "$ART/$id-typed.xml" >/dev/null 2>&1 || true

    if ! mtest resolve "$ART/$id-resolve" "$ROOT/resolve-phase.yaml" 300; then
      verdict="resolve"
    elif ! CASE_JSON="$case_json" bash "$ROOT/assert-meta.sh" "$base"; then
      verdict="metadata"
    elif ! mtest download "$ART/$id-download" "$ROOT/download-flow.yaml" 960; then
      verdict="download"
    fi
  fi

  if [ "$verdict" = "ok" ]; then
    echo "=== CASE $id PASS ==="
  else
    echo "=== CASE $id FAIL ($verdict) ==="
    failed_ids="$failed_ids $id:$verdict"
    if [ "$tier" = "soft" ]; then
      soft_fails=$((soft_fails + 1))
      echo "SOFT FAILURE ignored for gating: $id ($verdict)"
    else
      solid_fails=$((solid_fails + 1))
    fi
  fi

  restart_app
done < "$CASES"

echo "MATRIX SUMMARY: total=$total solid_failed=$solid_fails soft_failed=$soft_fails failed:$failed_ids"
if [ "$solid_fails" -gt 0 ]; then
  exit 1
fi
