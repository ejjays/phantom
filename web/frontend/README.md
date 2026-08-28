# Frontend

the React 19 SPA (Vite + Tailwind + styled-components). resolves media through the API, then does the heavy lifting in the browser — a Web Worker muxes 4K straight to disk via OPFS (`mediabunny`), so nothing buffers in memory. for the web overview see [`../README.md`](../README.md).

## Layout

```text
frontend/
├── src/
│   ├── lib/          # muxer, OPFS, SSE client, download orchestrator
│   ├── components/   # UI (modals, terminal, ui primitives)
│   ├── hooks/        # useSSE, useVideoInfo, useDownloadOrchestrator
│   ├── store/        # zustand (downloader state)
│   ├── pages/        # routes (guides, tools, about)
│   └── assets/icons/ # SVG icon modules — icons live here, never inlined
├── functions/        # Cloudflare Pages functions (edge)
└── public/           # static + libav/ffmpeg wasm
```

## Commands

```bash
npm run dev        # vite dev server
npm run build      # production build -> dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

deploys to **Cloudflare Pages** (`nex-stream`) — CI builds `dist/` and pushes it with wrangler on merge to `main`.
