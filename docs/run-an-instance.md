# Running an Instance (Web)

Phantom's web backend runs on Node.js 22+. Extraction is pure-JS per platform, `ffmpeg` handles muxing, Redis is for caching/queueing, and optionally Turso (libSQL) for the persistent registry. `yt-dlp` is an optional fallback for deep-scan. Built to self-host cheaply — including directly on Android via Termux.

## Prerequisites

- Node.js ≥ 22
- `ffmpeg` on `PATH` (`yt-dlp` optional — deep-scan fallback only). The browser muxes first (`mediabunny`, copy-only); the server only shells out to `ffmpeg` when a transcode, MP3, HLS remux, or tagging job needs it.
- Redis (local is fine — defaults to `redis://127.0.0.1:6379`)
- Optional: a Turso database for the persistent edge registry

## Quick Start — Termux (Android)

Automated provisioning (system update + dependencies + build):

```bash
curl -sL https://raw.githubusercontent.com/ejjays/phantom/main/scripts/setup/termux-install.sh | bash
```

The automated script installs a C toolchain (`build-essential`, i.e. clang + make) plus `python` — required because native addons like `re2` compile from source on Android (`.npmrc` supplies the `android_ndk_path` gyp variable).

## Manual Setup

```bash
pkg install -y build-essential   # Termux/Android only: native addons (re2) build from source
git clone https://github.com/ejjays/phantom.git
cd phantom

npm install          # root tooling (husky, prettier)
npm run install:web  # installs app, api & shared in one go
```

> `install:web` is a convenience wrapper — it runs a **single root workspace install** (the root `package-lock.json` is authoritative) and then builds `@phantom/extractors`. npm workspaces pulls in `web/app`, `web/api`, `web/shared`, `mobile`, and `packages/*` in one go. To add a package later, install it from the root — no per-folder `cd` needed. On **Termux/Android** no special flags are needed: `re2` is built natively using the Termux clang toolchain (hence `build-essential` above), and `libsql` / `@libsql/android-arm64` are substituted via the root `package.json` overrides.

Then create your env files — see [`env-variables.md`](env-variables.md) for the full reference and [where to get the API keys](env-variables.md#where-to-get-keys). At minimum set `VITE_API_URL` (app) to wherever the backend is reachable.

**Development** (two shells):

```bash
npm run api   # api on :5000 (tsc watch + server)
npm run ui    # app (Vite dev server)
```

**Production-style:**

```bash
npm run build:api      # installs + tsc build
npm run build:ui       # installs + vite build
cd web/api && npm start
```

## Docker (API)

Build context is the repo root; the image bundles `yt-dlp` + `ffmpeg` and listens on `8000`:

```bash
docker build -f web/api/Dockerfile -t phantom .
docker run -p 8000:8000 --env-file web/api/.env phantom
```

## Exposing It

Self-hosting from a phone or home box usually means a tunnel. The repo ships helpers in [`scripts/tunnels/`](../scripts/tunnels/) for Cloudflare, ngrok, and zrok. Start one, then point the app's `VITE_API_URL` at the tunnel URL.

Before putting an instance on the public internet, read [`protect-an-instance.md`](protect-an-instance.md).

## Mobile App

- **Android app** (standalone, no backend): see [`mobile-app.md`](mobile-app.md) and `mobile/README.md`

## Design Notes

- **No server for mobile** — each phone is its own residential IP + compute. Avoids datacenter bot-blocks and OOM kills on free tiers.
- **Client-side muxing is primary** — `mediabunny` (pure-JS muxer) runs in a Web Worker, streams to OPFS. Server fallback via `ffmpeg -c copy` only when client mux fails or browser unsupported.
- **Googlevideo throttle bypass** — api uses 8 MB ranged chunks, mobile uses 4 MB. Both parallel with per-chunk retry.
