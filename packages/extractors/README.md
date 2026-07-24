# @panther/extractors (prototype)

pulls the JS extractors out of `web/backend` into a standalone, dependency-free
package. it's the sibling to [`../web-mux`](../web-mux/README.md) — this
resolves a URL into format URLs, web-mux combines separate video/audio URLs
into one file.

## The pattern

each extractor is a factory that takes an `ExtractorEnv` instead of importing
project internals (`secureFetch`, `getProxiedStream`, redis, express, etc.):

```ts
export interface ExtractorEnv {
  fetch: typeof fetch;
  streamUrl(
    url: string,
    headers: Record<string, string>
  ): Promise<ReadableStream>;
}
```

pass nothing (`createXExtractor()`) and it uses plain global `fetch`, or
inject your own SSRF-safe fetch / proxy pool / auth headers.

ported so far: `x.ts`, `bluesky.ts`, `vimeo.ts` — 3 of 11, as a template for
the rest. each one runs its output through `normalizeTitle`/`normalizeArtist`
(vendored from `social.service.ts`) before returning, so titles/uploaders
match what the app shows — not just raw platform data.

for URLs you don't want to route by hand, `resolve(url)` picks the right
extractor by host and calls `getInfo` in one step; `getExtractor(url)` gives
you the extractor instance directly (for when you also need `getStream`):

```ts
import { resolve, getExtractor } from '@panther/extractors';

const info = await resolve('https://vimeo.com/76979871');

const extractor = getExtractor('https://vimeo.com/76979871');
const stream = extractor && (await extractor.getStream(info));
```

### Scope: what this is not

this package stops at "resolve a URL into normalized metadata + formats." it
does **not** include the racing orchestrator or metascraper fallback that
`web/backend/extractors/index.ts` has — the layer that races the real
extractor against an oEmbed/metascraper fetch and fires an early "metadata
found" progress event for the picker UI. that's left out on purpose:

- **metascraper is Node-only** (pulls in `got`, HTML scraping) — adding it
  would break this package's one real selling point, that it runs in Node,
  React Native, and the browser alike.
- **the racing/timeout/progress-event behavior is UI policy**, tuned to one
  app's picker modal — not something a generic library should dictate to
  every consumer.
- it's cheap to rebuild on top: `Promise.race([resolve(url), yourOwnMetadataFetch(), timeout(8000)])`
  is a few lines against the exports this package already gives you. you
  don't need the library to own the race, just to return promptly and
  resolve to `null` cleanly on a miss — which it already does.

### The ffmpeg wrinkle (bluesky, vimeo HLS fallback)

bluesky's streams are always HLS (`.m3u8`); vimeo falls back to HLS when no
progressive mp4 exists. the original app remuxes these with a spawned
`ffmpeg` process, which isn't something a pure-JS library should hardcode
(native binary dependency, breaks in browsers/RN). instead `getStream()`
calls an optional `env.remuxHls(url, headers)` hook and throws a clear error
if it's missing, rather than silently shelling out.

## Verifying it

two checks, both real (not mocks):

1. **`npm run demo:mock`** — builds `dist/` and runs `examples/mock-demo.ts`
   against the built output, using the same fixture as
   `web/backend/tests/extractors/x_extractor.test.ts`.
2. **tarball install** — `npm pack`, install the `.tgz` into a scratch
   project, run a script that imports `@panther/extractors` from
   `node_modules`. catches "works in the repo, missing from what gets
   published" bugs that `demo:mock` alone can't.

`examples/live-real.mjs` also runs the built package against real hosts,
using the same URLs as `mobile/tests/live/live-cases.json` — x.com, bsky.app,
vimeo.com — including a real `vimeo.getStream()` pulling actual bytes off
Vimeo's CDN.

## What's still unresolved

- 3 of 11 web extractors ported (`x.ts`, `bluesky.ts`, `vimeo.ts`). same
  mechanical conversion needed for the rest — vimeo (multi-step
  config/page-hash/player-page fallback chain) was the most involved of the
  three; the remaining 8 range between x's simplicity and vimeo's.
- `env.remuxHls` is unimplemented in `defaultEnv` — a consumer wanting
  bluesky or HLS-fallback vimeo streams has to supply it themselves (e.g.
  spawn `ffmpeg`, or a WASM remuxer for browser/RN use).
- no `getStream` proxy hardening (SSRF checks) in `defaultEnv` — intentional,
  keeps the lib dependency-free, but means server-side consumers should
  inject their own `streamUrl`.
- license: **MIT** (deliberate) — repo root is AGPL-3.0, but this package is
  permissively licensed so any project can adopt it; see root README.
- prototype, not published — same status as `../web-mux`.
