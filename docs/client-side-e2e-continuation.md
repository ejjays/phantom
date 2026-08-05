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
  `bf70ed96` (harden proxy, net routing, nits) → `bfa82893` (proxy body/encoding/
  Request routing fixes + portable harness + Termux bindings)
- `legacy/backend` branch holds the pre-strip backend archive.
- `ASSESSMENT.md` (repo root, untracked) = external review; §3 blockers are done,
  §6 is the live checklist (PO token, mp3 transcode, large file), §7 one-PR shape.

## 2. Committed fixes (bfa82893, pushed)

1. **`proxy.ts` POST body was `[object Request]`** — `body = request` stringified
   the incoming `Request`; YouTube answered "Invalid JSON payload … [object Request]".
   Fixed to `body = request.body` + `duplex: 'half'`.
2. **content-encoding mismatch** — outbound fetch auto-negotiates `br`; CF runtime
   decompresses br, node undici does not → streamed bodies mismatched the header
   (`ERR_CONTENT_DECODING_FAILED`). Fixed by forcing `Accept-Encoding: identity`
   upstream and stripping `content-encoding`/forwarded `Accept-Encoding` from
   responses.
3. **`String(Request)` = `[object Request]`** in `createProxyFetch`/`proxyFetch`
   — youtubei.js's HTTPClient always calls our fetch with `(Request, {body,
   headers, redirect, credentials})`, so player/next requests bypassed the proxy
   and hit YouTube cross-origin (403). Fixed via new `urlOf()` helper in
   `src/lib/net.ts` + explicit method/headers/body extraction
   (`new Headers(init?.headers)` — spreading a Headers instance yields nothing,
   content-type was being dropped).

Also: `scripts/e2e/` portable harness (server.cjs + run.cjs), root devDeps
Termux-native bindings (`@rolldown/binding-android-arm64`, `@rollup/rollup-android-arm64`,
`lightningcss-android-arm64`).

## 3. YouTube extraction root cause: rolldown lazily wraps the parser registry

**Symptom:** picker never opens; app error "Cannot read properties of null
(reading 'as')" despite clean 200 player + next responses through the proxy.

**Root cause (2 layers, both now fixed):**

1. **Lazy export wrappers.** rolldown represents youtubei.js's ESM namespace
   (`nodes.js` re-exports) as an object whose properties are `()=>Class` lazy
   initializer functions. `new Map(Object.entries(YTNodes))` in `parser.js` then
   stores the *wrappers*, not the classes — every `.type` validity check fails
   (`wrapper.type === undefined`), nested parses return null, and
   `VideoInfo`'s `next?.contents?.item().as(...)` crashes on null. Plain node is
   unaffected (real ESM namespace; V8 namespaces are enumerable).
   **Fix** (`web/frontend/src/lib/extractors/youtube.ts`): at module scope, iterate
   `Object.entries(YTNodes)`, unwrap each `()=>Class` (guard: not already a class
   via `Function.prototype.toString`), `Object.defineProperty` the real class
   back onto the namespace (JIT-generated constructors read `YTNodes.X` from it),
   and `addRuntimeParser(name, class)` into the parser's map. Relative imports
   into `node_modules` (youtubei.js's exports map blocks deep paths); sonar
   `no-internal-api-use` disabled per line.
2. **youtubei.js 17.2.0 bugs on today's YouTube responses** (patched in
   `scripts/patch-youtubei.cjs`, idempotent, wired into root `prepare`):
   - `getParserByName` throws `MODULE_NOT_FOUND` for renderers YouTube renamed
     after the release (`autonavEndpoint` → `AutonavEndpoint`,
     `maybeHistoryEndpoint` → `MaybeHistoryEndpoint`). The throw happens inside
     JIT class construction for the `autoplay` field of
     `SingleColumnWatchNextResults`, killing the whole watch-page parse.
     Patch: register a generic `YTNode` subclass with the same `static type`
     instead of throwing (nested renderer lists only — top-level unknown
     renderers keep the typed JIT path).
   - `VideoInfo` casts `next?.contents?.item().as(TwoColumnWatchNextResults)`
     unconditionally; the web client now serves `singleColumnWatchNextResults`.
     Patch: tolerate both — metadata enrichment skips, but formats/streaming
     data (player-derived) are unaffected.

**Result:** `node scripts/e2e/run.cjs rick` → picker opens, formats listed
(4K MP4 etc.) → `RESULT: PASS`. Remaining parser warnings
(`SingleColumnWatchNextResults not found!` / `VideoMetadata not found!`) are
informational JIT notices, not errors.

## 4. Spotify extraction was also broken (fixed)

`fetchSpotifyMeta` scraped the embed page for `data-testid="entity-name"`
markup; Spotify's embed now ships a Next.js shell with the track data inside a
JSON blob instead. Meta came back null → "Unsupported URL" alert.
**Fix** (`web/frontend/src/lib/extractors/spotify.ts`): added JSON-blob regex
fallbacks (`"title":"…"`, `"artists":[{"name":"…"}`, `"duration":N`,
cover `src="https://image-cdn…"`). `run.cjs spotify` → PASS (oEmbed not
needed; blob parsing keeps artist + duration).

## 5. Where E2E stands right now

Harness: `node scripts/e2e/server.cjs` serves `web/frontend/dist` on :8787 and
mounts the REAL bundled `proxy.ts`; `node scripts/e2e/run.cjs <youtube|short|rick|spotify>`
drives headless chromium against it (Termux chromium-browser 149, puppeteer-core 25).

- `rick` (dQw4w9WgXcQ): **PASS** — picker opens with formats (4K, …).
- `spotify` (open.spotify.com track): **PASS** — picker opens (1 audio format).
- `short` (BaW_jenozKc): fails with "This video is unavailable" — that's
  YouTube's own playabilityStatus for this dead video, not an app bug
  (node `getInfo` behaves identically).
- player responses are still limited (`formats=1` itag-18, no adaptive) — PO
  token isn't landing; format lists come through anyway (muxed 360p–1080p +
  4K itag appears on some responses).
- harness tweaks: static responses are `no-store` (Chrome reused stale bundles
  with `no-cache` + no validators); console handler captures warn-arg stacks.

## 6. Follow-ups (not this PR)

- **Mobile (`mobile/`):** uses `youtubei.js@17/bundle/browser.js` from CDN — no
  rolldown wrapping (library's own bundle), but the same 17.2.0 JIT-throw +
  VideoInfo-cast bugs apply if its watch-page flow reaches them. Verify mobile
  youtube extraction separately; apply the same two patches there if needed.
- PO token still unverified in the browser flow (best-effort catch is silent;
  node bgutils needs browser globals). Check `formats=1` response later.
- ASSESSMENT.md §6: mp3 transcode + ≥500 MB googlevideo stream still untested.

## 7. Termux environment gotchas (learned the hard way)

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
- **youtubei.js patch** (`scripts/patch-youtubei.cjs`) is idempotent and runs via
  root `prepare`; if you rebuild from a fresh `npm ci`, verify it ran
  (`node scripts/patch-youtubei.cjs` prints "already applied" or applies).
- Old phone backend still runs on the LAN (192.168.1.45:5000); the app discovers
  it via `/api/get-url` (404 on the static harness) and tries SSE there — harmless,
  ignore in logs.
- Build warnings (fine): direct-eval note from youtubei.js; INEFFECTIVE_DYNAMIC_IMPORT
  on previewStream (statically imported by VideoPreviewOverlay).
