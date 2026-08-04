# Environment Variables

Phantom boots without most of these — they enable optional features and degrade gracefully when unset. Backend vars go in `web/backend/.env`, frontend vars in `web/frontend/.env`, mobile vars in `mobile/.env` (or `eas.json` for builds).

## Where to Get Keys

| Provider    | Link                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Spotify     | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → create app, copy client id + secret |
| Gemini      | [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys) — free tier generous                        |
| Groq        | [console.groq.com/keys](https://console.groq.com/keys) — free tier generous                                      |
| Redis       | Local (`pkg install redis` on Termux) or free hosted [Aiven](https://aiven.io)                                   |
| Turso       | [app.turso.tech](https://app.turso.tech) → create DB, copy URL + auth token. CLI: `turso db tokens create <db>`  |
| Soundcharts | [soundcharts.com/api](https://soundcharts.com/api) — commercial, sandbox keys on request                         |
| AcoustID    | [acoustid.org/new-application](https://acoustid.org/new-application) → register app, copy API key (free)         |
| Kaggle      | [kaggle.com/settings](https://www.kaggle.com/settings) → "Create New API Token" (downloads `kaggle.json`)        |
| Sentry      | Project settings → Client Keys (DSN)                                                                             |

---

## Backend (`web/backend/.env`)

### Core

| Variable    | Default | Purpose                                                  |
| ----------- | ------- | -------------------------------------------------------- |
| `PORT`      | `5000`  | Port the server listens on                               |
| `API_ONLY`  | `false` | Set `true` to serve only API (skip bundled frontend)     |
| `LOG_LEVEL` | `info`  | Log level                                                |
| `NODE_ENV`  | —       | `production` tightens logging; `test` set by test runner |

### Data & Cache

| Variable           | Default                  | Purpose                                                                                                                           |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`        | `redis://127.0.0.1:6379` | Redis for locks + session/engine state                                                                                            |
| `TURSO_URL`        | —                        | libSQL/Turso URL for persistent edge registry. Falls back to in-memory mock if unset (and on Termux where native lib unavailable) |
| `TURSO_AUTH_TOKEN` | —                        | Auth token for Turso                                                                                                              |

### Metadata (Remix Lab extraction)

| Variable                               | Default | Purpose                                                                     |
| -------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `ACOUSTID_API_KEY`                     | —       | AcoustID fingerprint lookup (clip → MusicBrainz → ISRC). Degrades to Shazam |
| `GEMINI_API_KEY` (or `VERTEX_API_KEY`) | —       | Gemini, synthesizes search query when strict matches fail                   |
| `GROQ_API_KEY`                         | —       | Groq/Llama, same fallback role                                              |

### Remix Lab & Monitoring

| Variable                        | Default | Purpose                                      |
| ------------------------------- | ------- | -------------------------------------------- |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | —       | Kaggle credentials for Remix Lab engine sync |
| `SENTRY_DSN`                    | —       | Sentry error/performance monitoring          |

---

## Frontend (`web/frontend/.env`)

| Variable          | Default | Purpose                                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------------------- |
| `VITE_API_URL`    | —       | Backend base URL (e.g. your tunnel URL). Required for frontend to reach remote API. |
| `VITE_SENTRY_DSN` | —       | Sentry DSN for the frontend                                                         |

---

## Mobile (`mobile/.env` / `eas.json` env)

All mobile env vars are `EXPO_PUBLIC_*` — bundled into the app, so treat as **public**. Never put true secrets in `EXPO_PUBLIC_*` vars.

| Variable                                                             | Purpose                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`                                           | Updates tab                                                                       |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`                                      | Updates tab                                                                       |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`                                   | Native Google sign-in (Web OAuth client ID)                                       |
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`, `EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET` | Spotify extraction                                                                |
| `EXPO_PUBLIC_YT_COOKIE`                                              | Personal YouTube cookie — **leave blank in public builds** (extractable from APK) |
| `EXPO_PUBLIC_BILIBILI_COOKIE`                                        | Personal Bilibili cookie — **leave blank in public builds**                       |
| `EXPO_PUBLIC_TURSO_URL`, `EXPO_PUBLIC_TURSO_READ_TOKEN`              | Read-only edge registry (Spotify→YouTube mappings) — **must be read-only token**  |
| `EXPO_PUBLIC_SENTRY_DSN`                                             | Error tracking                                                                    |
| `EXPO_PUBLIC_DISABLE_FAST_RESOLVE`                                   | Skip in-memory resolve cache                                                      |

Local `.env` is gitignored. Preview/production builds need vars in `eas.json` `env`; dev client reads local `.env` through Metro.
