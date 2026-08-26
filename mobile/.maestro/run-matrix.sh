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

CASE_JSON_CUR=""
RUN_VERDICT="ok"
run_case() {
  local id=$1 url=$2 art=$3
  local base verdict
  base=$(adb logcat -d 2>/dev/null | grep -c 'E2E_META' || true)
  verdict="ok"

  if ! mtest focus "$art/$id-focus" "$ROOT/open-input.yaml" 300 < /dev/null; then
    verdict="focus"
  else
    adb shell input text "xxxx" < /dev/null
    adb shell input keyevent 67 67 67 67 < /dev/null
    for c in $(printf '%s' "$url" | grep -o .); do
      adb shell input text "$c" < /dev/null
      sleep 0.35
    done
    timeout 20 adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
    adb pull /sdcard/ui.xml "$art/$id-typed.xml" >/dev/null 2>&1 || true

    if ! mtest resolve "$art/$id-resolve" "$ROOT/resolve-phase.yaml" 300 < /dev/null; then
      verdict="resolve"
    elif ! CASE_JSON="$CASE_JSON_CUR" bash "$ROOT/assert-meta.sh" "$base" < /dev/null; then
      verdict="metadata"
    elif ! mtest download "$art/$id-download" "$ROOT/download-flow.yaml" 960 < /dev/null; then
      verdict="download"
    fi
  fi

  RUN_VERDICT=$verdict
}

CASES=$(mktemp)
if [ -n "$DISPATCH_URL" ]; then
  printf '{"id":"custom","tier":"solid","url":"%s","expect":{"minFormats":1}}\n' "$DISPATCH_URL" > "$CASES"
else
  jq -c --arg m "$TIER_MODE" '.[] | select(.tier == $m or $m == "all")' "$ROOT/e2e-cases.json" > "$CASES"
fi

total=$(wc -l < "$CASES")
if [ "$total" -eq 0 ]; then
  echo "MATRIX: no cases selected for tier=$TIER_MODE — failing, empty matrix is a bug"
  exit 1
fi
echo "MATRIX: tier=$TIER_MODE cases=$total"
solid_fails=0
soft_fails=0
failed_ids=""
RESULTS=$(mktemp)
export META_OUT
META_OUT="${META_OUT:-$(mktemp)}"

summary_row() {
  local status=$1 id=$2 tier=$3 verdict=$4
  local mrow title up fmts size res kind
  if [ -s "$META_OUT" ]; then
    mrow=$(jq -r '[
      (.title // "-" | if type == "string" then (.[0:56] | gsub("\\|"; "/")) else tostring end),
      (.uploader // "-" | gsub("\\|"; "/")),
      (.formats // "-"),
      (if .anyFilesize == true then "yes" else "no" end),
      (if .anyResolution == true then "yes" else "no" end),
      (if .audioOnly == true then "audio" else "video" end)
    ] | @tsv' "$META_OUT" 2>/dev/null || printf -- '-\t-\t-\t-\t-\t-')
  else
    mrow=$(printf -- '-\t-\t-\t-\t-\t-')
  fi
  IFS=$'\t' read -r title up fmts size res kind <<< "$mrow"
  local note="-"
  if [ -n "$verdict" ] && [ "$verdict" != "ok" ]; then
    note="failed at $verdict"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$status" "$id" "$tier" "$title" "$up" "$fmts" "$size" "$res" "$kind" "$note" >> "$RESULTS"
}

while IFS= read -r case_json <&3; do
  [ -z "$case_json" ] && continue
  id=$(printf '%s' "$case_json" | jq -r .id)
  url=$(printf '%s' "$case_json" | jq -r .url)
  tier=$(printf '%s' "$case_json" | jq -r .tier)
  echo "=== CASE $id [$tier] $url ==="
  CASE_JSON_CUR="$case_json"
  RUN_VERDICT="ok"
  : > "$META_OUT"
  run_case "$id" "$url" "$ART/attempt1"
  if [ "$RUN_VERDICT" != "ok" ]; then
    echo "--- retrying $id once after failure ($RUN_VERDICT)"
    restart_app
    RUN_VERDICT="ok"
    : > "$META_OUT"
    run_case "$id" "$url" "$ART/attempt2"
  fi
  verdict=$RUN_VERDICT

  if [ "$verdict" = "ok" ]; then
    echo "=== CASE $id PASS ==="
    summary_row "PASS" "$id" "$tier" ""
  else
    echo "=== CASE $id FAIL ($verdict) ==="
    failed_ids="$failed_ids $id:$verdict"
    if [ "$tier" = "soft" ]; then
      soft_fails=$((soft_fails + 1))
      echo "SOFT FAILURE ignored for gating: $id ($verdict)"
      summary_row "SOFT FAIL" "$id" "$tier" "$verdict"
    else
      solid_fails=$((solid_fails + 1))
      summary_row "FAIL" "$id" "$tier" "$verdict"
    fi
  fi

  restart_app
done 3< "$CASES"

passed=$((total - solid_fails - soft_fails))
{
  echo "## mobile e2e"
  echo ""
  echo "$passed/$total passed · tier $TIER_MODE · solid failed $solid_fails · soft failed $soft_fails"
  echo ""
  echo "| status | platform | title | uploader | fmts | size | res | kind | note |"
  echo "|---|---|---|---|---|---|---|---|---|"
  while IFS=$'\t' read -r st id tier title up fmts size res kind note; do
    echo "| $st | $id | $title | $up | $fmts | $size | $res | $kind | $note |"
  done < "$RESULTS"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "MATRIX SUMMARY: total=$total solid_failed=$solid_fails soft_failed=$soft_fails failed:$failed_ids"
if [ "$solid_fails" -gt 0 ]; then
  exit 1
fi
