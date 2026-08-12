#!/usr/bin/env bash
# publishes an APK + update manifest to Supabase storage (public apk/ bucket)
# usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bash scripts/publish-apk.sh path/to/app.apk 1.2.2 [notes...]
set -euo pipefail
cd "$(dirname "$0")/.."

APK="${1:?apk path required}"
VERSION="${2:?version required}"
NOTES="${*:3:-}"

[ -f "$APK" ] || { echo "apk not found: $APK" >&2; exit 1; }
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c%s "$APK")
AUTH="Authorization: Bearer $SUPABASE_SERVICE_KEY"
DEST="apk/phantom-v$VERSION.apk"

curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/$DEST" \
  -H "$AUTH" -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary "@$APK"

MANIFEST=$(mktemp)
printf '{"version":"%s","apkUrl":"%s/storage/v1/object/public/%s","sha256":"%s","size":"%s","notes":"%s","publishedAt":"%s"}\n' \
  "$VERSION" "$SUPABASE_URL" "$DEST" "$SHA" "$SIZE" "$NOTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MANIFEST"
trap 'rm -f "$MANIFEST"' EXIT

curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/apk/latest.json" \
  -H "$AUTH" -H "Content-Type: application/json" \
  --data-binary "@$MANIFEST"

echo "published v$VERSION ($SHA)"