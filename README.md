<p align="center">
  <a href="https://github.com/ejjays/phantom">
    <img width="1400" height="460" alt="Cyan Phantom" src="mobile/assets/phantom-hero.svg" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/ejjays/phantom/actions/workflows/ci.yml"><img src="https://github.com/ejjays/phantom/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://app.deepsource.com/gh/ejjays/phantom/"><img src="https://app.deepsource.com/gh/ejjays/phantom.svg/?label=active+issues&show_trend=true&token=AjSUM1LGBlY2Uzo6_spxrx9Q" alt="DeepSource" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT%2FApache%202.0-green?style=flat" alt="License: MIT/Apache 2.0" /></a>
</p>

---

## What this is

Phantom is hand-built pure-JS extractors that download 4K+ video and audio. It pushes heavy media work onto your device (browser or phone) instead of a server — so it stays free, ad-free, and unmetered.

**Web and Android from one repo:**

| App             | What runs where                                                                | Repo path |
| --------------- | ------------------------------------------------------------------------------ | --------- |
| **Web**         | Extraction on server (Node), browser mux via `mediabunny`, `ffmpeg` server fallback | `web/`    |
| **Android**     | Full pipeline on-device (Expo RN, Hermes, ffmpeg-kit)                          | `mobile/` |

---

## Mobile App Preview

<table align="center">
  <tr>
    <td align="center"><img src="mobile/assets/screenshots/home_screen.webp" width="150" alt="Home Screen" /></td>
    <td align="center"><img src="mobile/assets/screenshots/video_download.webp" width="150" alt="Video Download" /></td>
    <td align="center"><img src="mobile/assets/screenshots/audio_download.webp" width="150" alt="Audio Download" /></td>
  </tr>
  <tr>
    <td align="center"><img src="mobile/assets/screenshots/updates_feed.webp" width="150" alt="Updates Feed" /></td>
    <td align="center"><img src="mobile/assets/screenshots/update_detail.webp" width="150" alt="Update Detail" /></td>
    <td align="center"><img src="mobile/assets/screenshots/comments_section.webp" width="150" alt="Comments" /></td>
  </tr>
  <tr>
    <td align="center"><img src="mobile/assets/screenshots/settings_screen.webp" width="150" alt="Settings" /></td>
    <td align="center"><img src="mobile/assets/screenshots/account_details.webp" width="150" alt="Account" /></td>
    <td align="center"><img src="mobile/assets/screenshots/choose_avatar.webp" width="150" alt="Avatar" /></td>
  </tr>
</table>

---

---

## Supported platforms

| Logo | Platform | Web | Mobile | Video | Audio | Images | Notes |
| ---- | -------- | :-: | :-----: | :---: | :---: | :----: | ----- |
| <img src="web/site/public/logos/youtube.svg" alt="YouTube logo" width="31"> | [YouTube](https://www.youtube.com) | ✅ | ✅ | ✅ | ✅ | ➖ | playlists, shorts, 4K |
| <img src="web/site/public/logos/spotify.svg" alt="Spotify logo" width="26"> | [Spotify](https://open.spotify.com) | ✅ | ✅ | ✅ | ✅ | ➖ | tracks & albums resolve via youtube search |
| <img src="web/site/public/logos/soundcloud.svg" alt="SoundCloud logo" width="39"> | [SoundCloud](https://soundcloud.com) | ✅ | ✅ | ➖ | ✅ | ➖ | audio-only service |
| <img src="web/site/public/logos/bilibili.svg" alt="Bilibili logo" width="29"> | [Bilibili](https://www.bilibili.com) | ✅ | ✅ | ✅ | ✅ | ➖ | some videos need a cookie |
| <picture><source media="(prefers-color-scheme: dark)" srcset="web/site/public/logos/tiktok.svg" /><img src="web/site/public/logos/tiktok-light.svg" alt="TikTok logo" width="24"></picture> | [TikTok](https://www.tiktok.com) | ✅ | ✅ | ✅ | ✅ | ✅ | videos + photo carousels |
| <img src="web/site/public/logos/instagram.svg" alt="Instagram logo" width="26"> | [Instagram](https://www.instagram.com) | ✅ | ✅ | ✅ | ✅ | ✅ | reels, posts, multi-image picker |
| <img src="web/site/public/logos/facebook.svg" alt="Facebook logo" width="26"> | [Facebook](https://www.facebook.com) | ✅ | ✅ | ✅ | ✅ | ✅ | public posts only |
| <picture><source media="(prefers-color-scheme: dark)" srcset="web/site/public/logos/threads.svg" /><img src="web/site/public/logos/threads-light.svg" alt="Threads logo" width="24"></picture> | [Threads](https://www.threads.com) | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| <picture><source media="(prefers-color-scheme: dark)" srcset="web/site/public/logos/x.svg" /><img src="web/site/public/logos/x-light.svg" alt="X logo" width="20"></picture> | [X / Twitter](https://x.com) | ✅ | ✅ | ✅ | ✅ | ➖ | videos & gifs only |
| <img src="web/site/public/logos/bluesky.svg" alt="Bluesky logo" width="28"> | [Bluesky](https://bsky.app) | ✅ | ✅ | ✅ | ❌ | ➖ | hls only, no audio |
| <img src="web/site/public/logos/vimeo.svg" alt="Vimeo logo" width="26"> | [Vimeo](https://vimeo.com) | ✅ | ✅ | ✅ | ❌ | ➖ | hls only, no audio |
| <img src="web/site/public/logos/dailymotion.svg" alt="Dailymotion logo" width="30"> | [Dailymotion](https://www.dailymotion.com) | ✅ | ✅ | ✅ | ❌ | ➖ | hls only, no audio |
| <img src="web/site/public/logos/reddit.svg" alt="Reddit logo" width="26"> | [Reddit](https://www.reddit.com) | ✅ | ✅ | ✅ | ✅ | ➖ |  |
| <img src="web/site/public/logos/pinterest.svg" alt="Pinterest logo" width="26"> | [Pinterest](https://www.pinterest.com) | ✅ | ✅ | ✅ | ✅ | ✅ | video pins + photos |
| <img src="web/site/public/logos/twitch.svg" alt="Twitch logo" width="24"> | [Twitch](https://www.twitch.tv) | ✅ | ✅ | ✅ | ❌ | ➖ | clips, hls only |
| <img src="web/site/public/logos/snapchat.svg" alt="Snapchat logo" width="26"> | [Snapchat](https://www.snapchat.com) | ✅ | ✅ | ✅ | ✅ | ➖ | spotlight videos + t.snapchat.com shorts |
| <img src="web/site/public/logos/watchluna.svg" alt="Watchluna logo" width="26"> | [Watchluna](https://lunagate.org) | ❌ | ✅ | ✅ | ❌ | ➖ | movies & shows, 1080p hls |

---

## Quick start (web)

> Web UI wip — mobile is the focus for now.

```bash
# Prerequisites: Node 22+, ffmpeg, Redis (yt-dlp optional — deep-scan fallback only)
git clone https://github.com/ejjays/phantom.git
cd phantom

npm install              # root tooling (husky, prettier)
npm run install:web      # installs app, api, shared

# Create env files (see docs/env-variables.md)
cp web/api/.env.example web/api/.env
cp web/app/.env.example web/app/.env

# Dev (two terminals)
npm run api   # api on :5000
npm run ui    # app dev server
```

**Production-style:**

```bash
npm run build:api
npm run build:ui
cd web/api && npm start
```

**Docker (api only):**

```bash
docker build -f web/api/Dockerfile -t phantom .
docker run -p 8000:8000 --env-file web/api/.env phantom
```

---

## Quick start (Android)

```bash
cd mobile
npm install
npm start       # Expo dev client
# or
eas build --profile development  # dev client APK
```

Prebuilt APKs: see [the mobile README](mobile/README.md) (Android only — iOS untested/unsupported).

---

## Architecture overview

```
phantom/
├── web/
│   ├── app/            # React 19 + Vite + Tailwind + Styled Components
│   ├── api/            # Express 5 + pure-JS extractors + ffmpeg + Redis + Turso
│   ├── site/           # Astro landing page (merges app under /app/ at deploy)
│   └── shared/         # @phantom/shared (Zod schemas)
├── mobile/             # Expo SDK 57, RN 0.86, Hermes, New Arch
│   ├── src/extractors/ # 16 pure-JS platform extractors
│   ├── src/lib/        # download pipeline, social, net, notify
│   └── src/components/ # UI, sheets, backgrounds, webviews
├── packages/
│   ├── extractors/     # @phantom/extractors (shared fb/threads/social)
│   └── web-mux/        # @phantom/web-mux (shared media mux core)
├── scripts/            # termux install, tunnels
└── docs/               # self-host, env, hardening, API, mobile
```

**Key architectural decisions** live in [`docs/run-an-instance.md`](docs/run-an-instance.md#design-notes).

---

## Documentation

| Doc                                                          | What it covers                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`docs/run-an-instance.md`](docs/run-an-instance.md)         | Prerequisites, Termux, Docker, tunnels, dev/prod commands              |
| [`docs/env-variables.md`](docs/env-variables.md)             | Every env var, defaults, where to get API keys                         |
| [`docs/protect-an-instance.md`](docs/protect-an-instance.md) | Hardening a public deployment (API key, URL signing, rate limits, TLS) |
| [`docs/api.md`](docs/api.md)                                 | Endpoint contracts, request/response shapes, SSE events                |
| [`docs/mobile-app.md`](docs/mobile-app.md)                   | Android app architecture, extractors, download pipeline, EAS build     |
| [`docs/phone-worker-setup.md`](docs/phone-worker-setup.md)   | Legacy: using a spare phone as yt-dlp/media relay for the web API      |
| [`docs/license.md`](docs/license.md)                           | Which license covers what (apps vs packages)                           |

---

## License

See [`LICENSE`](LICENSE) and [`docs/license.md`](docs/license.md).

---

## Disclaimer

For personal use only. Download only content you have rights to.
