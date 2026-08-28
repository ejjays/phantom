# phantom audit + cleanup plan

post full-repo audit (branch `refactor/maintainability-fixes`). scores: backend 8/7/7 · frontend 8/7/7 · mobile 8/7/6 · shared/cross-workspace 6/5/4 (robustness/scalability/maintainability).

## verdict in one line

code inside each workspace is genuinely solid (deep tests, typed errors, memory-safe streaming, near-zero `any`) — the debt lives *between* workspaces: mass duplication, dead subsystems, string-matched error flow.

## what's already good

- 800+ test cases across ~220 files, failure paths tested (byte-exact resume, xff-spoof-resistant auth)
- memory discipline holds everywhere — streaming/chunked, no whole-file buffering
- mobile extractors uniform across 17 platforms, 12 typed error factories, gated network
- backend: fail-closed auth, SSRF defense at DNS layer, client-rotation retries
- comment discipline + type safety followed repo-wide

## workstreams

### 1. mobile ffmpeg-kit / docs reconciliation — SKIPPED (owned by `feat/ffmpeg-kit-replacement`)

### 2. delete dead bullmq subsystem — backend
- `src/utils/infra/queue.util.ts` + `src/services/ytdlp/lock.ts` create a queue with **no Worker anywhere** — jobs pile up in redis forever, `releaseLock` is a no-op. lock.ts exports are re-exported but never imported.
- delete both files, drop `acquireLock`/`releaseLock`/`downloadQueue` re-exports from `ytdlp/index.ts` + `ytdlp.service.ts` shim, remove `bullmq` dep, delete dead queue tests (`tests/flows/queue.integration.test.ts`, `tests/manual/test_add_job.ts`, `tests/manual/check_queue.ts`). real concurrency control is `security.util.ts` redis guard — untouched.

### 3. frontend imports `@phantom/web-mux` — kill the 1,110-line duplicate
- `web/frontend/src/lib/{muxer,mux-core,mux-codecs,mux.worker,resumableFetch}.ts` duplicate the package verbatim and have already drifted (different error-class names, package gained `filePrefix`/`workerUrl`/stale-sweep options). zero imports of the package exist.
- swap frontend to `@phantom/web-mux`, delete local copies, keep worker wiring via package `workerUrl` option, fix drifted error names at call sites, add dep to `web/frontend/package.json`.

### 4. backend x/vimeo/bluesky → `@phantom/extractors`
- 3 divergent copies each (~1,400 duplicated lines); the package's `ExtractorEnv` DI (`env.fetch`/`env.streamUrl`) exists for exactly this. backend copies import `secureFetch`/`getProxiedStream` directly.
- migrate backend modules to thin adapters injecting backend-specific fetch/proxy into package extractors, mirroring the facebook/threads shim pattern. verify parity via existing extractor tests.

### 5. typed error classes in backend
- error flow currently string-matched: `(error as Error).message === 'RESOLVE_TIMEOUT'` (video.controller), `error.message.includes('SSRF')` (security.util). rename a string, break control flow silently.
- add `src/utils/errors.ts` with `ResolveTimeoutError` + `SsrfError`; throw/catch `instanceof` instead. mobile already does this right — backend catches up.

### 6. unbounded caches + kotlin thread safety
- backend: `RESOLUTION_CACHE` (spotify/index.ts) and `aiCache` (spotify/ai.ts) grow forever. `lru-cache` already a dep (info-core uses it) — convert both to `LRUCache` with max+ttl.
- mobile: `mutableMapOf` in `MediaDownloaderModule.kt` written from multiple threads → `ConcurrentHashMap`. native module change ⇒ needs new EAS build (bump app version on next release build).

## verification gates per workstream

`node node_modules/typescript/bin/tsc --noEmit` per workspace + relevant vitest files only (termux: never whole suite) · frontend mux contract/routing/codec tests · backend extractor + auth + security tests · clean git history, one commit per workstream.

## later (not this PR)

- unbounded `prefetchPromises` map, `useMediaConverter` 20-field re-render facade, dead code sweep (fsm.util, resetStore, no-op interval), styled-components straggler, libsql override runtime landmine, renovate guard for the RN-markdown patch
