# Running an Instance (Web)

Phantom's web backend runs on Node.js 22+. It shells out to `yt-dlp` and `ffmpeg`, uses Redis for caching/queueing, and optionally Turso (libSQL) for the persistent registry. Built to self-host cheaply — including directly on Android via Termux.

## Prerequisites

- Node.js ≥ 22
- `yt-dlp` and `ffmpeg` on `PATH`
- Redis (local is fine — defaults to `redis://127.0.0.1:6379`)
- Optional: a Turso database for the persistent edge registry

## Quick Start — Termux (Android)

Automated provisioning (system update + dependencies + build):

```bash
curl -sL https://raw.githubusercontent.com/ejjays/phantom/main/scripts/setup/termux-install.sh | bash
```

## Manual Setup

```bash
git clone https://github.com/ejjays/phantom.git
cd phantom

npm install          # root tooling (husky, prettier)
npm run install:web  # installs frontend, backend & shared in one go
```

> `install:web` is a convenience wrapper — it runs a **single root workspace install** (the root `package-lock.json` is authoritative) and then builds `@phantom/extractors`. npm workspaces pulls in `web/frontend`, `web/backend`, `web/shared`, `mobile`, and `packages/*` in one go. To add a package later, install it from the root — no per-folder `cd` needed. On **Termux/Android** the install adds `--force --ignore-scripts` — `libsql` is OS-restricted and native addons like `re2` have no Android prebuilt, but both are mocked / fall back at runtime, so the backend still boots.

Then create your env files — see [`env-variables.md`](env-variables.md) for the full reference and [where to get the API keys](env-variables.md#where-to-get-keys). At minimum set `VITE_API_URL` (frontend) to wherever the backend is reachable.

**Development** (two shells):

```bash
npm run api   # backend on :5000 (tsc watch + server)
npm run ui    # frontend (Vite dev server)
```

**Production-style:**

```bash
npm run build:api      # installs + tsc build
npm run build:ui       # installs + vite build
cd web/backend && npm start
```

## Docker (Backend)

Build context is the repo root; the image bundles `yt-dlp` + `ffmpeg` and listens on `8000`:

```bash
docker build -f web/backend/Dockerfile -t phantom .
docker run -p 8000:8000 --env-file web/backend/.env phantom
```

## Exposing It

Self-hosting from a phone or home box usually means a tunnel. The repo ships helpers in [`scripts/tunnels/`](../scripts/tunnels/) for Cloudflare, ngrok, and zrok. Start one, then point the frontend's `VITE_API_URL` at the tunnel URL.

Before putting an instance on the public internet, read [`protect-an-instance.md`](protect-an-instance.md).

## Mobile App & Remix Lab

- **Android app** (standalone, no backend): see [`mobile-app.md`](mobile-app.md) and `mobile/README.md`
- **Remix Lab** (ML stem/chord analysis on free GPUs): see [`remix-lab.md`](remix-lab.md)
