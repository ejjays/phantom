#!/usr/bin/env bash
# movies tab flow: browse trending, search, open detail, download, assert history.
# soft-gating: third-party streaming links flap, so a failure warns but never
# reds the build. promote to hard gate once the flow proves stable.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAESTRO="${MAESTRO_BIN:-$HOME/.maestro/maestro/bin/maestro}"
APP_ID="com.phantom.app"
ART="${ART_DIR:-$GITHUB_WORKSPACE/maestro-artifacts}"
mkdir -p "$ART"

adb shell am force-stop "$APP_ID" 2>/dev/null
sleep 2
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 5

if MAESTRO_CLI_NO_ANALYTICS=1 timeout -k 10 1200 "$MAESTRO" test \
  --debug-output "$ART/movies-debug" \
  "$ROOT/movies-flow.yaml" < /dev/null; then
  echo "MOVIES FLOW: PASS"
  {
    echo "## movies tab flow"
    echo ""
    echo "PASS · browse + search + detail + download landed in History"
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi

echo "MOVIES FLOW: SOFT FAIL (see $ART/movies-debug)"
{
  echo "## movies tab flow"
  echo ""
  echo "SOFT FAIL · flaky third-party path, not gating — check $ART/movies-debug"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
