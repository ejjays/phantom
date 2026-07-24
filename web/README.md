# Web

website/browser side of Panther and API. for the project overview see [`../README.md`](../README.md).

three parts, each installs and builds on its own (no root workspace):

- **`frontend/`** — the React 19 SPA (Vite, Tailwind). does browser-side muxing and talks to the API over SSE. deploys to **Cloudflare Pages** (`nex-stream`).
- **`backend/`** — the Express 5 API: stream resolution, muxing, the Spotify race, the Remix Lab proxy. deploys to **Koyeb** (Docker).
- **`shared/`** — zod schemas + cross-workspace types. both import it via the `@shared/*` alias; it ships nowhere on its own.

`frontend` and `backend` never import each other — the only thing they share is `shared/`, so the contract between them lives there.

to install all three at once, run `npm run install:web` from the repo root — it just `npm install`s each folder in turn, so every part keeps its own `package-lock.json`. to add a package, install it inside that specific folder.
