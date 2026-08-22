# ASTRO.md — Phantom Landing & SEO Migration Plan

Status (2026-08-22): **Phases 0–5 implemented.** Landing is live Astro at `/`,
SPA serves from `/app/`, docs routes hidden, full SEO layer in. Remaining:
phase 6 content hub + Cloudflare dashboard tasks below.

## Deploying (GitHub Actions → Cloudflare Pages)

Deploy runs via `.github/workflows/ci.yml` `deploy-frontend` job (push to main,
gated on test-frontend + path filters incl. web/site + scripts/build-site.sh):

1. `npm ci --ignore-scripts` (+ explicit linux-x64 native bindings, now also
   `@astrojs/compiler-binding-linux-x64-gnu`)
2. `bash scripts/build-site.sh` — astro build → SPA build → merge into
   `web/site/dist`
3. Pages Functions copied from `web/frontend/functions/` into dist
4. `wrangler pages deploy web/site/dist --project-name c-phantom`

After first deploy: check Security→Bots that AI crawlers aren't blocked at the
edge; set old domains (nex-stream etc.) to 301 into c-phantom.pages.dev;
resubmit sitemap-index.xml in GSC.

Goal: make `c-phantom.pages.dev` fully crawlable by Google **and** AI answer engines
(ChatGPT, Perplexity, Claude, Gemini), so Phantom ranks even for people who have never
heard of it.

## Why this exists

Current state:

- `web/frontend/` is a pure SPA → ships an empty `<div id="root">`. Google indexes it
  slowly/unreliably; Bing, link previews and **all major AI crawlers see nothing**.
- `landing/` is a finished Vite+React prototype of the new landing look.
- Domain signals are split: canonical says `c-phantom.pages.dev`, sitemap +
  `vercel.json` point at `nex-stream.pages.dev`.

Decision (2026-08): **c-phantom.pages.dev is THE domain.** Everything else redirects
into it.

## Target architecture

One Cloudflare Pages project (`c-phantom`), two static builds merged into one `dist/`:

```
https://c-phantom.pages.dev
├── /                 ← Astro landing (real static HTML — bots read it instantly)
├── /guides/*         ← Astro content pages (future SEO articles + docs home)
├── /app/*            ← current React SPA (the downloader tool), unchanged UX
└── /404.html         ← Astro custom 404
```

- Astro = public face + content. Ships ~zero JS, perfect Core Web Vitals, HTML-first.
- SPA stays as-is under `/app` — rewriting a zustand/SSE/muxer app into Astro is risk
  with zero SEO upside (the tool page itself doesn't need ranking; the landing does).
- One project, one deploy, one domain accumulating all authority.

---

## Phase 0 — Domain consolidation (do first, independent of Astro)

1. `web/frontend/index.html`: canonical already OK → keep
   `https://c-phantom.pages.dev/`.
2. `web/frontend/public/robots.txt` + `sitemap.xml`: rewrite every
   `nex-stream.pages.dev` URL → `c-phantom.pages.dev`.
3. Delete stale `web/frontend/vercel.json` (it 301s the whole site to nex-stream —
   actively harmful).
4. Old Pages projects (nex-stream etc.): set blanket permanent redirect →
   `https://c-phantom.pages.dev` equivalent paths.
5. Google Search Console (c-phantom property): submit sitemap, request recrawl of `/`.
   If nex-stream was previously the verified primary, use Change of Address tool.

Exit check: `curl -s https://c-phantom.pages.dev/sitemap.xml | grep -c nex-stream` → 0.

## Phase 1 — Scaffold Astro workspace

- New workspace `web/site/` (fits house layout: web/frontend, web/backend, web/site).
- `npx astro@latest init` equivalents, minimal:
  - `astro.config.mjs`: `output: 'static'`, `site: 'https://c-phantom.pages.dev'`,
    integrations: `@astrojs/react`, `@astrojs/sitemap`, tailwind v4 via
    `@tailwindcss/vite` (matches frontend's Tailwind 4).
  - TypeScript strict, same eslint style as siblings.
- Deps: astro, @astrojs/react, @astrojs/sitemap, react/react-dom (19), framer-motion,
  lucide-react, tailwindcss v4. No embla unless marquee needs drag — prefer CSS loop.

## Phase 2 — Port landing design into Astro

Port from `landing/src/components/` into `web/site/src/components/`:

| Prototype component | Astro treatment |
| --- | --- |
| Navbar, Footer | plain `.astro` (static HTML, zero JS) |
| Hero, Features, HowItWorks, Faq, Cta | `.astro` shells; only wrap framer-motion bits as `client:visible` React islands |
| PlatformMarquee | pure CSS keyframe loop (drop embla) |
| ScreensShowcase | `astro:assets <Image>` per screenshot, explicit width/height |
| Starfield, GlowBlob | CSS/SVG only (no JS canvas if possible) |
| Ghost, PhoneMockup | static markup |

Content source: move `landing/src/lib/content.ts` → `web/site/src/content/site.ts`
(typed). FAQ text lives here once and feeds BOTH visible section AND JSON-LD.

Assets: convert `public/fonts/*.ttf` → woff2 (smaller), preload the 2 hero weights,
`font-display: swap`. Screenshots stay webp via astro:assets (auto AVIF/WebP variants).

LCP budget: hero headline or first screenshot must be `<img fetchpriority="high">`,
no font-blocked render. Target LCP < 1.2s mobile.

## Phase 3 — SEO layer on the Astro site

Meta & social:

- Unique `<title>` (~55ch) + `<meta description>` (~155ch) per page, templated in
  `Layout.astro`.
- OG + Twitter card tags; dedicated `og.png` (1200×630) in `public/`.
- Canonical on every page (self-referencing).

Structured data (JSON-LD, one `<script type="application/ld+json">` block each):

- `SoftwareApplication` (+ `offers` free, `featureList`, `aggregateRating` ONLY if we
  have real ratings).
- `FAQPage` — questions MUST match visible FAQ text verbatim (Google requirement).
- `HowTo` matching the HowItWorks steps.
- `WebSite` + `Organization`; `BreadcrumbList` on guides.

Files:

- `@astrojs/sitemap` → `sitemap-index.xml`.
- `public/robots.txt` (2026-current, verified Aug 2026):
  - AI crawlers come in THREE categories — allow them deliberately:
    - search-index crawlers decide whether you're citable in AI answers:
      OAI-SearchBot (ChatGPT Search), Claude-SearchBot (Claude search),
      PerplexityBot.
    - user-triggered fetchers fetch pages when a user asks that engine about you:
      ChatGPT-User, Claude-User, Perplexity-User.
    - training crawlers: GPTBot, ClaudeBot, CCBot, Bytespider… (blocking these does
      NOT remove you from AI answers; Phantom wants max visibility → allow).
  - `User-agent: * Allow: /` already permits compliant bots; still name each
    retrieval bot explicitly with `Allow: /` (audit-friendly + insurance against
    future default-deny platforms).
  - Google-Extended is NOT a crawler — just an opt-out token for Gemini/Vertex
    training. Never appears in logs; blocking it doesn't affect Search or AI
    Overviews. Leave unblocked.
  - Bytespider ignores robots.txt anyway (documented non-compliance) — don't bother.
  - `Disallow: /app/` once SPA moves there (shell has no crawlable content).
  - `Sitemap:` line last.
- ⚠️ **Cloudflare network-layer check (we host on CF Pages):** Cloudflare now gates
  AI crawlers at the edge and from Sep 2026 blocks training/agent crawlers by default
  for some new zones. After deploy, verify dashboard → Security/Bots (AI Audit):
  our permissive robots.txt must not be overridden by a managed block.
- `public/llms.txt`: STILL worth shipping, with honest expectations — Google
  officially ignores it (May/Jun 2026 guidance; Mueller likens it to meta keywords)
  and ~97% of files never get fetched. But cost ≈ 0, Perplexity and Anthropic
  tooling read it in some modes, Chrome Lighthouse audits its reachability, and
  agentic browsers are arriving. Small curated markdown: H1 name, blockquote
  summary, sections linking landing/guides/app. Keep it consistent with robots.txt
  posture (don't publish llms.txt while blocking the same crawlers).
- Google's own May 2026 AI-optimization guidance: no special "AI markup" exists or
  is needed — AI Overviews reward exactly classic SEO: crawlable HTML, clear
  content, supported structured data. So Phase 3's core work IS the AI strategy.

## Phase 4 — Move the SPA under /app

1. Frontend build: `vite build --base=/app/` (assets resolve under subpath).
2. `react-router`: add `basename="/app"` to `BrowserRouter`/createBrowserRouter.
3. Audit hardcoded absolute asset paths (`/logo.webp` in index.html → `%BASE_URL%`
   or relative).
4. Output merge: build site → `web/site/dist/`, then copy frontend build →
   `web/site/dist/app/`. Small script `scripts/build-site.sh` orchestrating both.
5. `web/site/public/_redirects` (Cloudflare Pages format):
   ```
   /app/*        /app/index.html   200
   /resources/*  /                 301
   /guide/*      /                 301
   /about        /                 301
   ```
6. Update every internal link that points at the tool (navbar CTA etc.) → `/app`.

Gotchas: env vars (`VITE_*`) unaffected (build-time); Sentry DSN env-based ✓; test a
deep link like `/app/tools/remix-lab` after deploy.

## Phase 5 — Hide existing docs

- Remove routes `/resources/*`, `/guide/*`, `/about` (+ their redirect shims) from
  the SPA router. KEEP the page components in `src/pages/` — they're the seed content
  for the future docs section inside Astro.
- `_redirects` entries from step 5 above keep old URLs from becoming soft-404 noise
  in Search Console.

## Phase 6 — Content program (what actually wins "nobody knows me" searches)

**Status: TODO — next up.**

Ranking for people who never heard of Phantom comes from long-tail content, not the
landing alone:

- `/guides/` hub in Astro (content collections, markdown):
  - "download youtube video 4k android", "spotify playlist to mp3", "tiktok no
    watermark", soundcloud/instagram/facebook variants, "extract audio from video".
  - Each guide: real how-to steps + embedded mention of the tool linking to `/app`
    + `Article` + `HowTo` + `FAQPage` schema + BreadcrumbList.
- Seed with rewritten material from the hidden doc pages (`FormatGuide`,
  `VideoGuide`, `SecurityPrivacy`) — user-approved reuse.
- Off-page basics: GitHub README link, Product Hunt launch, Reddit/X presence,
  alt-store listings. Backlinks remain the #1 ranking lever.
- Submit sitemap in GSC + Bing Webmaster (Bing powers ChatGPT search results);
  enable IndexNow if supported.

Cadence: 1–2 guides/month beats 20 dumped at once. Never doorway-spam (thin pages
for every keyword = manual penalty).

## Phase 7 — CI/CD & verification

Cloudflare Pages project `c-phantom`: build command runs `scripts/build-site.sh`,
output dir `web/site/dist`.

Verification checklist (every phase exit):

- [ ] `curl -s https://c-phantom.pages.dev/ | grep '<h1>'` — real content in raw HTML
- [ ] `curl -s -A GPTBot https://c-phantom.pages.dev/` returns identical full HTML
- [ ] Google Rich Results Test: SoftwareApplication + FAQPage valid, no errors
- [ ] PageSpeed Insights mobile ≥ 95, LCP < 1.2s, CLS = 0, INP < 100ms
- [ ] `/app` deep links work; old doc URLs 301 correctly
- [ ] sitemap-index.xml lists all pages, zero nex-stream references
- [ ] llms.txt reachable, robots.txt validates (GSC robots tester)

Termux note: run astro/vite via `node ../node_modules/...` bin paths (env-shebang
lie, same as AGENTS.md §Shortcut Scripts). Never run full vitest suite locally.
Astro-specific Termux setup (solved 2026-08-22, all self-healing via
`web/site/scripts/binding-fix.mjs` postinstall):

- `@astrojs/compiler` publishes NO android-arm64 native binding → fix installs
  `@astrojs/compiler-binding-wasm32-wasi@0.3.2` tarball manually (npm refuses:
  cpu=wasm32 check) into root node_modules.
- That wasm loader preopens `/` for WASI → Android denies (`UVWASI_EACCES`) →
  binding-fix patches `astro.wasi.cjs`: wasi root preopen → `process.cwd()`.
- Wasm runtime deps (`@napi-rs/wasm-runtime`, `@emnapi/core`, `@emnapi/runtime`,
  `tslib`) must be devDeps of web/site or npm prunes them.
- Astro 7 needs `cookie@^2`; express-era `cookie@0.7` used to hoist at root and
  shadow it (build chunks resolve from repo root) → `cookie@^2.0.1` added as root
  devDependency so v2 hoists; dependents needing 0.x nest their own copy.
- Build command: `cd web/site && node ../../node_modules/astro/bin/astro.mjs build`.
- If astro:assets/sharp fails later on android, switch image service to a
  no-op/passthrough config rather than fighting sharp bindings.

## Success metrics (monthly)

- GSC impressions/clicks trend for non-brand queries ("youtube downloader android"
  etc.).
- Ask ChatGPT + Perplexity monthly: "best free downloader app for android" /
  brand queries — track when Phantom starts appearing/cited.
- Core Web Vitals field data once traffic flows.

## Explicitly rejected alternatives

- Next.js for the whole thing: overkill, heavier JS, SSR server needed — no benefit
  for a static landing.
- Rewriting the tool SPA in Astro: huge risk, zero SEO gain on the tool route.
- Keeping two live domains: splits authority, confuses crawlers. Dead end.
- Prerender-only plugins on the existing SPA: band-aid; Astro gives cleaner content
  pipeline (collections, islands, assets) for the same effort.
