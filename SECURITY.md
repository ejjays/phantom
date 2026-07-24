# Security policy

## Reporting a vulnerability

please report security issues **privately** — don't open a public issue for them.

use GitHub's [private vulnerability reporting](https://github.com/ejjays/panther/security/advisories/new) (the repo's **Security → Report a vulnerability** tab). if it isn't enabled yet, turn it on under _Settings → Code security → Private vulnerability reporting_.

include the affected endpoint/component, steps to reproduce, and the impact. a suggested fix is welcome but not required. this is a solo-maintained project, so reports are triaged as fast as is realistically possible — expect an initial reply within a few days.

## Supported versions

security fixes land on `main`. if you self-host, track `main` or pin a tagged release and update when a fix is published. there's no separate LTS branch.

## What the backend already does

Panther is built to be safe to self-host:

- **SSRF protection** — every outbound media/proxy fetch resolves the target host and rejects private, loopback, and link-local IP ranges. raw `fetch` / `child_process.spawn` are blocked at lint time by custom rules (`no-raw-fetch`, `no-raw-spawn`), so new code has to go through the vetted helpers.
- **signed media URLs** — `/proxy` and stream links are HMAC-signed with an expiry; forged or expired links get a `403`.
- **optional API-key auth** — setting `API_KEY` requires a key on the expensive routes (`/info`, `/stream-urls`, `/convert`, `/proxy`, `/api/*`). `127.0.0.1` is exempt so local use stays frictionless.
- **rate limiting** — global and per-endpoint limits, plus a per-IP concurrency guard on downloads.
- **hardened HTTP** — Helmet with a CSP, a 1 MB request-body cap, and explicit CORS handling.
- **dependency scanning** — `npm audit` + OSV-Scanner run in CI, with DeepSource for static analysis.

## Running a public instance

authentication is **opt-in and off by default** (so a localhost dev setup needs no config). if you expose an instance to the internet, read [`docs/protect-an-instance.md`](docs/protect-an-instance.md) — at minimum:

- set a strong `API_KEY`, and set `PROXY_SIGNING_SECRET` so signed URLs survive restarts.
- put it behind a reverse proxy or tunnel with TLS.
- a public **web** frontend can't keep an API key secret in the browser — gate an open instance with a bot challenge such as Cloudflare Turnstile instead.

## Scope

Panther only downloads free, publicly accessible content and caches _resolution metadata_, never media files. please use it for content you have the right to process.
