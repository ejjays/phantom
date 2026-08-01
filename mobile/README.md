# Phantom Android

Standalone Expo/React Native app (SDK 56, RN 0.85, Hermes, New Architecture). Runs the full pipeline on-device: resolve → download → mux → save. No backend. Includes a small Updates tab (Supabase) for app news, reactions, comments.

## Why on-device

The web backend hits two walls on free hosting:

1. **Datacenter IPs get bot-blocked** by YouTube. PO tokens help but can't fake a residential IP.
2. **`yt-dlp` + `ffmpeg` OOM** the tiny free-tier containers.

A phone solves both: residential IP (no bot-block) + local compute (nothing to OOM, no server bill). Each user's device is its own worker.

## Architecture

```
resolve(url) → dispatch(host) → extractor.getInfo() → VideoInfo/Format[]
                                  ↓
                          YouTube: WebView (youtubei.js + PO token)
                                  ↓
PickerModal → useDownload → downloadPipeline.ts
                                  ↓
              ranged chunks (4 MB, 4× parallel) → ffmpeg-kit -c copy → gallery
                                  ↓
                          notify + foreground service
```

**Three tabs** (`App.tsx`): Home (resolve/download), Settings, Updates (Supabase feed).

### Resolution (`src/extractors/index.ts`)

- In-memory cache (`lib/cache.ts`, skip via `EXPO_PUBLIC_DISABLE_FAST_RESOLVE=1`)
- `dispatch()` routes by hostname to platform extractor
- YouTube/Spotify/SoundCloud stream **partial** `VideoInfo` via `onPartial` for early UI hydration
- Spotify→YouTube mappings from read-only Turso edge registry (`lib/social/registry.ts`)

### Extractors (`src/extractors/`)

| Platform                                                                                           | Implementation                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube                                                                                            | Hidden WebView (`YouTubeExtractorWebView`), same-origin `youtubei.js`, BotGuard PO token + sig/`n` decipher on device IP, `postMessage` bridge |
| Spotify                                                                                            | Client-credentials API (`spotify/api.ts`), track/album/playlist → search YouTube                                                               |
| Bilibili, TikTok, Instagram, X, Threads, Facebook, Bluesky, Reddit, SoundCloud, Vimeo, Dailymotion | Pure JS: fetch page/API → parse embedded JSON (regex fallback) via `gatedFetch`                                                                |

All extractors return common `VideoInfo` / `Format[]` (`types.ts`). Pure-JS extractors use `gatedFetch` (`lib/net.ts`) — per-host concurrency + 429 backoff to avoid bot-blocks.

**Errors:** Extractors throw typed `ExtractorError` (`errors.ts`, carries `retryable` flag). UI surfaces message + retry.

### Download pipeline (`lib/download/downloadPipeline.ts`)

1. **Chunked ranged download** (`download.ts`) — 4 MB ranges, 4× parallel for YouTube/Spotify `googlevideo`; HLS segments 8–16× parallel (`hls.ts`)
2. **Mux** (`mux.ts`) — `ffmpeg-kit -c copy` (no re-encode), or transcode to MP3, or assemble HLS
3. **Tag & save** (`save.ts`/`gallery.ts`) — `expo-media-library` → gallery
4. **Notify** (`notify.ts` + `fgservice.ts`) — download progress + foreground service

**Memory discipline:** Never buffer full media in RAM. Stream/chunk to disk. Temp files tracked & deleted in `finally` (mirror `downloadPipeline.ts`'s `track()`).

**Thread discipline:** Heavy work (mux, hashing) runs native (ffmpeg-kit) or in worklets. Long ops report progress, cancelable via `AbortSignal`.

**Network discipline:**

- Extractor/API calls → `gatedFetch` (per-host limit + 429 backoff)
- Media byte downloads → dedicated parallel paths with own retry, **NOT gated** (gating kills throughput)
- All fetches take `AbortSignal`, honor cancel

---

## Stack highlights

| Area       | Choice                                                                          | Why                                                        |
| ---------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Styling    | `twrnc` (runtime Tailwind)                                                      | NativeWind's `lightningcss` has no Termux/aarch64 prebuild |
| UI/Motion  | Reanimated 4, Gesture Handler, Skia, Lottie, SVG                                | New Arch required                                          |
| Media      | `ffmpeg-kit-react-native` (community fork, `full-gpl`)                          | On-device mux, GPL-3.0 → app is effectively GPL-3.0        |
| Extraction | `react-native-webview` (YouTube), `youtubei.js` + `bgutils-js` (CDN in WebView) | Hermes has no `eval`/DOM; BotGuard + cipher need both      |
| Auth       | Supabase: native Google (nitro) + anonymous fallback                            | Dual path; anon backs signed-out reactions/comments        |
| State      | React local + TanStack Query                                                    | No Zustand (unlike web)                                    |

---

## Auth (Updates tab only)

Two coexisting paths in `lib/social/googleAuth.ts` + `lib/social/updates.ts`:

1. **Native Google** — `react-native-nitro-google-signin` → `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`
2. **Anonymous** — `auth.signInAnonymously()` auto-creates session for reactions/comments when not Google-signed-in

**Nonce:** SHA-256 hex (via `expo-crypto`) to Google `configure({ nonce })`; **raw** nonce to `signInWithIdToken`. Supabase "skip nonce check" = **OFF**.

**Cascade:** `signIn()` (silent, returning users) → fallback `presentExplicitSignIn()` (full chooser). `profiles.username` required; RLS in `supabase/schema.sql`. Supabase Google provider must list **Web** OAuth client ID (token audience).

---

## Build & Deploy (EAS — Android only)

- **Managed / CNG** — no `android/`/`ios/` committed; EAS generates native at build. Package `com.nexstream.app`.
- `app.json`: no iOS config; `eas.json` builds APKs only.
- Profiles: `development` (dev client, internal, `EAS_SKIP_AUTO_FINGERPRINT=1`), `preview` (internal, arm64-v8a), `production` (apk, arm64-v8a). `appVersionSource: remote`.
- Config plugins: notify-kit (fg service `dataSync`), ffmpeg-kit (`full-gpl`), media-library, splash, font/image/sharing/status-bar, `react-native-nitro-google-signin` (needs `iosUrlScheme` placeholder or prebuild throws), `./plugins/withLargeHeap`, `./plugins/withNotificationIcon`.
- **OTA:** `expo-updates` (`runtimeVersion: appVersion`) ships JS only. **Any native change = new EAS build** — bump version when adding native modules.

---

## Testing & CI

- **Vitest** (`npm test` = `vitest run`); tests in `mobile/tests/*.test.ts` (node env).
- **Mock network:** `vi.mock('../src/lib/net')` (`gatedFetch`); inline HTML/JSON fixtures.
- **Extractor convention:** extractors **throw** typed `ExtractorError` on failure. Tests assert `await expect(getInfo(...)).rejects.toThrow(/.../iu)` — NOT `toBeNull()`. `null` = unsupported host.
- **Resource discipline:** run only relevant test files — never full suite (Termux phantom killer).
- Scripts: `typecheck` (`tsc --noEmit`), `test`, `lint` (changed), `lint:all` (`eslint .`).
- **CI** (`.circleci/config.yml`, `test-mobile`, `cimg/node:22.12`): `npm ci` → `tsc --noEmit` → `npm run lint:all` → `npx vitest run`. Runs only when `mobile/` changes (`halt-unless-changed`).

---

## Env vars (`EXPO_PUBLIC_*` — bundled, treat as public)

| Var                                          | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`          | Updates tab                                                                |
| `GOOGLE_WEB_CLIENT_ID`                       | Native Google sign-in (Web OAuth client ID)                                |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify extraction                                                         |
| `YT_COOKIE`, `BILIBILI_COOKIE`               | Personal cookies — **leave blank in public builds** (extractable from APK) |
| `TURSO_URL`, `TURSO_READ_TOKEN`              | Read-only edge registry (Spotify→YouTube mappings)                         |
| `SENTRY_DSN`                                 | Error tracking                                                             |
| `DISABLE_FAST_RESOLVE`                       | Skip in-memory resolve cache                                               |

Local `.env` is gitignored. Preview/prod builds need vars in `eas.json` `env`; dev client reads local `.env` via Metro.

---

## Gotchas

- **JS hot-reloads via Metro; native code does not** — new native module = EAS rebuild, not OTA.
- **New Architecture required** (nitro, reanimated 4, worklets).
- **YouTube must run in WebView** — Hermes lacks `eval`/DOM; BotGuard + cipher need both. `DEBUG` flag in `extractors/youtube/webviewSource.ts` logs steps to Metro.
- **`googlevideo` full-file GET throttled** to ~playback speed → 4 MB ranged chunks restore full bandwidth.
- **ffmpeg-kit is community fork** (`full-gpl`) → app is effectively **GPL-3.0**; binaries 4 KB-page aligned (Play Store 16 KB-page needs rebuilt `.aar`).
- **Android only** — iOS code in deps but untested/unsupported (no Apple account).
- **Nitro Google One-Tap:** silent `signIn()` → `presentExplicitSignIn()` fallback on `isNoSavedCredentialFoundResponse`, `null` on cancel. Avoid `createAccount()` — can **hang** on first sign-in.
