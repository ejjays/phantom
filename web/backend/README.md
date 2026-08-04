# Backend

the Express 5 + TypeScript service backing the **Remix Lab** and **Song Key Changer** tools. stream resolution, muxing, and media extraction moved client-side (see `web/frontend/src/lib/extractors`) — this backend no longer touches video pipelines. project overview in [`../../README.md`](../../README.md).

## Layout

```text
backend/
├── src/
│   ├── app.ts              # Express setup, middleware, route wiring, lifecycle
│   ├── instrument.ts       # Sentry instrumentation — must load before app.ts
│   ├── controllers/
│   │   ├── remix.controller.ts      # Remix Lab kernel proxy + stems/chords/beats
│   │   └── keychanger.controller.ts # pitch-shift / key-change uploads
│   ├── routes/
│   │   ├── remix.routes.ts          # Remix Lab kernel proxy + results
│   │   └── keychanger.routes.ts     # key-changer route
│   ├── services/
│   │   ├── extract.service.ts       # audio fingerprint + metadata extraction
│   │   ├── ug-grounding.service.ts  # Ultimate Guitar tab lookup
│   │   └── sessionStore.ts          # remix engine session registry
│   ├── utils/
│   │   ├── infra/          # db (Turso), logger, redis, trace, metrics
│   │   └── network/        # auth, security (SSRF guard)
│   └── types/              # ambient module declarations
├── tests/                  # Vitest suites (remix, keychanger, auth)
├── scripts/                # test orchestration, Termux shim
└── Dockerfile              # container build (node:22-slim base)
```

## Routes

`remix.routes.ts` proxies the Python Remix Lab kernel and serves stem/chord/beat results. `keychanger.routes.ts` handles pitch-shift uploads. Both are gated by `requireApiKey` (`utils/network/auth.util.ts`) on public instances.

| Method | Path                 | Purpose                                                                 |
| ------ | -------------------- | ----------------------------------------------------------------------- |
| `POST` | `/api/remix/*`       | Remix Lab: register engine, process, wake, save, history, stems, export |
| `GET`  | `/api/key-changer/*` | Key changer: upload → detect → download                                 |

## Environment

configure via `web/backend/.env`. full reference in [`../../docs/env-variables.md`](../../docs/env-variables.md). minimum to get something useful:

- `GEMINI_API_KEY` and/or `GROQ_API_KEY` — AI query synthesis fallback in metadata extraction.
- `TURSO_URL` + `TURSO_AUTH_TOKEN` — persistent engine/session state (falls back to in-memory).
- `API_ONLY=true` — disable serving the bundled `frontend/dist` (split deployments).

## Running

```bash
npm install
npm run dev          # tsc + node, listens on :5000 (or $PORT)
```

other scripts:

- `npm run build` — TypeScript compile to `dist/`.
- `npm test` — Vitest suite (sequential, Termux-friendly).
- `npm run lint:all` — ESLint over the package.

## Requirements

- Node.js ≥ 22 — matches the Dockerfile and the project root.
- `ffmpeg` 7.x or 8.x on `PATH` — key changer audio processing.
- Redis — locks + session state; an in-process mock is used in tests when none is reachable.

before putting an instance on the public internet, read [`../../docs/protect-an-instance.md`](../../docs/protect-an-instance.md).
