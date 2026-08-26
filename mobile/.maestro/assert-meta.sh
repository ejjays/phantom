#!/usr/bin/env bash
set -uo pipefail

base=${1:?baseline E2E_META count required}
CASE_JSON=${CASE_JSON:?case json required}

meta_wait=${META_WAIT:-120}
latest=""
while [ "$SECONDS" -lt "$meta_wait" ]; do
  latest=$(adb logcat -d 2>/dev/null | grep 'E2E_META' | tail -n +"$((base + 1))" | tail -n 1)
  [ -n "$latest" ] && break
  sleep 2
done
if [ -z "$latest" ]; then
  echo "META FAIL: no E2E_META line within ${meta_wait}s past baseline $base"
  exit 1
fi
json=${latest#*'[E2E_META] '}
echo "META: $json"
if [ -n "${META_OUT:-}" ]; then
  printf '%s' "$json" > "$META_OUT"
fi

j() { printf '%s' "$json" | jq -r "$1"; }

title=$(j '.title // ""')
uploader=$(j '.uploader // ""')
formats=$(j '.formats // 0')
has_thumb=$(j '.hasThumb // false')
any_size=$(j '.anyFilesize // false')
any_res=$(j '.anyResolution // false')
audio_only=$(j '.audioOnly // false')

min_formats=$(printf '%s' "$CASE_JSON" | jq -r '.expect.minFormats // 1')
media_kind=$(printf '%s' "$CASE_JSON" | jq -r '.expect.mediaKind // ""')
want_thumb=$(printf '%s' "$CASE_JSON" | jq -r '.expect.wantThumb // false')
want_res=$(printf '%s' "$CASE_JSON" | jq -r '.expect.wantResolution // false')
want_size=$(printf '%s' "$CASE_JSON" | jq -r '.expect.wantFilesize // false')
reject_uploader=$(printf '%s' "$CASE_JSON" | jq -r '.expect.rejectUploader // ""')
expect_author=$(printf '%s' "$CASE_JSON" | jq -r '.expect.expectAuthor // ""')
case_id=$(printf '%s' "$CASE_JSON" | jq -r '.id // ""')
allow_platform_uploader=$(printf '%s' "$CASE_JSON" | jq -r '.expect.allowPlatformUploader // false')

fails=0
pass() { echo "META PASS: $1"; }
bail() { echo "META FAIL: $1"; fails=$((fails + 1)); }

if [ -n "$title" ]; then pass "title present: $title"; else bail "title present"; fi

if [ -n "$uploader" ]; then
  pass "uploader present: $uploader"
else
  bail "uploader present"
fi

if [ -n "$reject_uploader" ] && [ "$uploader" = "$reject_uploader" ]; then
  bail "uploader is junk placeholder '$reject_uploader'"
else
  pass "uploader not junk placeholder"
fi

up_lower=${uploader,,}
id_lower=${case_id,,}
if [ "$allow_platform_uploader" != "true" ] && [ "${#case_id}" -ge 5 ] && [ -n "$up_lower" ] && [[ "$up_lower" == *"$id_lower"* ]]; then
  bail "uploader looks like platform-name fallback ('$uploader' ~ '$case_id')"
else
  pass "uploader not platform fallback"
fi

if [ -n "$expect_author" ]; then
  exp_lower=${expect_author,,}
  if [ "$up_lower" = "$exp_lower" ]; then
    pass "author matches '$expect_author'"
  else
    bail "author '$uploader' != expected '$expect_author'"
  fi
fi

if [ "$formats" -ge "$min_formats" ] 2>/dev/null; then
  pass "formats $formats >= $min_formats"
else
  bail "formats $formats >= $min_formats"
fi

if [ "$want_thumb" = "true" ]; then
  if [ "$has_thumb" = "true" ]; then pass "thumbnail url present"; else bail "thumbnail url present"; fi
fi

if [ "$want_res" = "true" ]; then
  if [ "$any_res" = "true" ]; then pass "resolution present"; else bail "resolution present"; fi
fi

if [ "$want_size" = "true" ]; then
  if [ "$any_size" = "true" ]; then pass "filesize present"; else bail "filesize present"; fi
fi

if [ "$media_kind" = "audio" ]; then
  if [ "$audio_only" = "true" ]; then pass "audio-only formats"; else bail "audio-only formats"; fi
elif [ "$media_kind" = "video" ]; then
  if [ "$audio_only" = "false" ]; then pass "has video format"; else bail "has video format"; fi
fi

if [ "$fails" -gt 0 ]; then
  echo "META RESULT: $fails failure(s)"
  exit 1
fi
echo "META RESULT: all good"
