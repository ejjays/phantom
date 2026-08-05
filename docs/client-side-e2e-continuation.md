# Client-Side Pipeline — E2E Continuation Notes

Handoff doc for continuing work on PR #25 (`refactor/client-side-pipeline`).
Written after the 2026-08-05 E2E debugging session on a Termux phone.

---

## 1. What this branch is

Move the entire video pipeline client-side: `web/frontend` (Vite SPA on Cloudflare
Pages) resolves → downloads → muxes in the browser. A Pages Function
(`web/frontend/functions/api/proxy.ts`) is the only "backend": a CORS/rate-limited
reverse proxy to the allowed platform hosts. `web/backend` is stripped to
Remix Lab + Song Key Changer only.

- PR: https://github.com/ejjays/phantom/pull/25
- Commits so far: `1b51987c` (refactor) → `f6387602` (deepsource fixes) →
  `bf70ed96` (harden proxy, net routing, nits)
- `legacy/backend` branch holds the pre-strip backend archive.
- `ASSESSMENT.md` (repo root, untracked) = external review; §3 blockers are done,
  §6 is the live checklist (PO token, mp3 transcode, large file), §7 one-PR shape.

## 2. Session outcome: three real bugs found & fixed (uncommitted)

All three are in the working tree, NOT yet committed. Frontend typecheck + build
are green.

1. **`proxy.ts` POST body was `[object Request]`** — `body = request` stringified
   the incoming `Request`; YouTube answered "Invalid JSON payload … [object Request]".
   Fixed to `body = request.body` + `duplex: 'half'`. This would have broken in
   production too.
2. **content-encoding mismatch** — outbound fetch auto-negotiates `br`; CF runtime
   decompresses br, node undici does not → streamed bodies mismatched the header
   (`ERR_CONTENT_DECODING_FAILED`). Fixed by forcing `Accept-Encoding: identity`
   upstream and stripping `content-encoding`/forwarded `Accept-Encoding` from
   responses. Deterministic everywhere.
3. **`String(Request)` = `[object Request]`** in `createProxyFetch`/`proxyFetch`
   — youtubei.js's HTTPClient always calls our fetch with `(Request, {body,
   headers, redirect, credentials})`, so player/next requests bypassed the proxy
   and hit YouTube cross-origin (403). Fixed via new `urlOf()` helper in
   `src/lib/net.ts` (Request → `.url`) + explicit method/headers/body extraction
   (`{...init.headers}` on a Headers instance spreads to nothing — content-type
   was also being dropped).

### Files changed (working tree)
- `web/frontend/functions/api/proxy.ts`
- `web/frontend/src/lib/net.ts` (`urlOf`, proxyFetch, gatedFetch)
- `web/frontend/src/lib/extractors/youtube.ts` (`createProxyFetch`)
- `package.json` / `package-lock.json` — root devDeps:
  `@rolldown/binding-android-arm64@^1.2.1`, `@rollup/rollup-android-arm64@^4.62.4`,
  `lightningcss-android-arm64@^1.33.0` (Termux-native bindings so `npm ci` + build
  work on Android; harmless elsewhere)
- `scripts/e2e/server.cjs` + `scripts/e2e/run.cjs` — NEW portable E2E harness
  (copied from `/data/data/com.termux/files/usr/tmp/opencode/e2e/`, paths made
  relative). Chrome path/env overridable via `CHROME_BIN`, `E2E_PORT`.

## 3. Where E2E stands right now

Harness: `node scripts/e2e/server.cjs` serves `web/frontend/dist` on :8787 and
mounts the REAL bundled `proxy.ts`; `node scripts/e2e/run.cjs <youtube|short|rick|spotify>`
drives headless chromium against it (Termux chromium-browser 149, puppeteer-core 25).

Status after the fixes:
- `[proxy]` log shows config / iframe_api / base.js / **player / next** all flowing
  through the proxy with bodies + content-type intact.
- youtubei.js now gets real YouTube data and parses it
  (`[YOUTUBEJS][Parser]: Q: SingleColumnWatchNextResults not found!`).
- **Blocking issue:** extraction still fails after a successful player fetch:
  - `BaW_jenozKc` → app error "YouTube extraction failed: This video is unavailable"
  - `dQw4w9WgXcQ` (rick) → "Cannot read properties of null (reading 'as')"
    (null deref inside youtubei.js parser)
- Hypothesis (unverified): the player/next responses are error/bot-check payloads —
  ANDROID_VR client, PO token may be silently failing (best-effort catch swallows
  it), and the proxy drops youtubei's client headers (X-Youtube-Client-Version,
  X-GOOG-API-FORMAT-VERSION, X-Youtube-Client-Name) — only Range/Accept/
  Accept-Language/Content-Type are forwarded; platformHeaders then override UA.

**Next step (in progress at handoff):** capture the raw player response —
`run.cjs` already logs `PLAYER-RESP: <first 300 chars>` for player calls
(decoded URL match was just fixed); the last run with that logging was aborted
before output. Read the PLAYER-RESP line to see whether YouTube returns a
playabilityStatus ERROR / bot check or a real format list.

## 4. Continuation plan

1. Run `node scripts/e2e/run.cjs rick` and read the `PLAYER-RESP:` line in the
   console tail → determine if YouTube rejects the request or if it's a client
   header problem.
2. If bot-check/ERROR: forward youtubei's client headers through the proxy
   (`X-Youtube-Client-Version` etc. — add to the forwarded-header list, or better:
   forward ALL request headers except the blocklist: host, cookie, origin,
   accept-encoding, connection, etc.). Re-test.
3. If PO token is the problem: confirm by logging the `makePoToken` catch
   (currently silent). bgutils challenge runs on device; headless chromium +
   `--no-sandbox` should support it — verify `po token` actually generates.
4. Once the picker dialog opens (run.cjs prints `formats found: N` + button
   labels) → run the rest of ASSESSMENT.md §6: mp3 transcode (mp3_synthetic),
   spotify, a ≥500 MB googlevideo stream, real PO token.
5. Commit the working tree changes (suggest: `fix: proxy request body, encoding, Request-object routing`),
   update ASSESSMENT.md §6 with results, comment on PR #25.

## 5. Termux environment gotchas (learned the hard way)

- **pkill self-match:** `pkill -f "e2e/server.cjs"` matches the shell's own
  cmdline → kills the tool shell → command hangs. Use
  `for pid in $(pgrep -f "e2e/server[.]cjs"); do kill $pid; done` (bracket trick).
- **Server restart hangs the tool:** run kill and start in SEPARATE commands;
  start with `setsid nohup node scripts/e2e/server.cjs </dev/null >/tmp/e2e.log 2>&1 & disown`.
  (/tmp read-only on Termux → the harness bundles to `os.tmpdir()` =
  `$PREFIX/tmp`, writable.)
- **`/usr/bin/env` does not exist** on Termux → `.bin` shebangs break ("tsc: not
  found" / "bad interpreter"). Fix: `termux-fix-shebang` on each resolved
  `node_modules/.bin/*` target (`readlink -f` first). Node_modules is disposable.
- **Native bindings:** vite build needs `@rollup/rollup-android-arm64` +
  `@rolldown/binding-android-arm64` (exact rolldown version!) + `lightningcss-android-arm64`
  (1.33.0). A timed-out `npm install` can silently delete them → reinstall with
  `--no-save` if missing.
- Old phone backend still runs on the LAN (192.168.1.45:5000); the app discovers
  it via `/api/get-url` (404 on the static harness) and tries SSE there — harmless,
  ignore in logs.
- Build warnings (fine): direct-eval note from youtubei.js; INEFFECTIVE_DYNAMIC_IMPORT
  on previewStream (statically imported by VideoPreviewOverlay).
