#!/usr/bin/env bash
# publish an APK to a GitHub release + update manifest to Supabase storage (public apk/ bucket)
# usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bash scripts/publish-apk.sh path/to/app.apk 1.2.2 [notes...]
set -euo pipefail
cd "$(dirname "$0")/.."

APK="${1:?apk path required}"
VERSION="${2:?version required}"
NOTES="${*:3:-}"

[ -f "$APK" ] || { echo "apk not found: $APK" >&2; exit 1; }
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"
command -v gh >/dev/null || { echo "gh cli required" >&2; exit 1; }

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c%s "$APK")
AUTH="Authorization: Bearer $SUPABASE_SERVICE_KEY"
TAG="v$VERSION"
ASSET="phantom-$VERSION.apk"

# free-plan storage caps per file at 50 MB, so the APK lives on a github
# release (range requests work, matching the app's chunked downloader)
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --title "$TAG" --notes "${NOTES:-}" >/dev/null
fi
gh release upload "$TAG" "$APK" --clobber
APK_URL=$(gh release view "$TAG" --json assets --jq ".assets[] | select(.name == \"$ASSET\") | .browserDownloadUrl")
[ -n "$APK_URL" ] || { echo "asset url not found on release" >&2; exit 1; }

# idempotent: creates the public apk/ bucket on first run
curl -fsS -X POST "$SUPABASE_URL/storage/v1/bucket" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"apk","public":true}' >/dev/null 2>&1 || true

MANIFEST=$(mktemp)
printf '{"version":"%s","apkUrl":"%s","sha256":"%s","size":"%s","notes":"%s","publishedAt":"%s"}\n' \
  "$VERSION" "$APK_URL" "$SHA" "$SIZE" "$NOTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MANIFEST"
trap 'rm -f "$MANIFEST"' EXIT

curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/apk/latest.json" \
  -H "$AUTH" -H "Content-Type: application/json" \
  --data-binary "@$MANIFEST"

echo "published v$VERSION -> $APK_URL"
echo "manifest: $SUPABASE_URL/storage/v1/object/public/apk/latest.json"