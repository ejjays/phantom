# Protecting an instance

a localhost or personal instance needs no extra setup — auth is off by default. if you expose Panther to the public internet, harden it as below. none of this requires paid infrastructure.

## 1. Require an API key

set `API_KEY` (see [`env-variables.md`](env-variables.md)). once set, the expensive routes (`/info`, `/stream-urls`, `/convert`, `/proxy`, `/api/*`) require it; `127.0.0.1` stays exempt so local tools keep working.

clients can pass the key three ways:

```
Authorization: Bearer <key>
X-API-Key: <key>
?key=<key>            # for browser-driven download links
```

> a public **web** frontend can't keep a key secret — anyone can read it in the browser. for an open, human-facing instance, use a bot challenge (e.g. Cloudflare Turnstile) instead of / alongside `API_KEY`, and reserve `API_KEY` for programmatic / API-only access.

## 2. Pin the URL-signing secret

`/proxy` and stream URLs are HMAC-signed with an expiry. by default the secret is random per boot, so links break on restart. set a fixed `PROXY_SIGNING_SECRET` (and optionally tune `PROXY_URL_TTL_SECONDS`, default 6h) so signed links survive restarts. forged or expired links are rejected with `403`.

## 3. Rate limits (already on)

out of the box, the server applies:

- a global limit of **100 requests / 15 min** on `/api/*`,
- **15 requests / min** on `/info` and `/stream-urls`,
- a per-IP **concurrency guard of 2** on `/convert` and `/proxy`.

tune these in `web/backend/src/app.ts` if your traffic profile differs.

## 4. Terminate TLS in front

run behind a reverse proxy or tunnel that provides HTTPS. the server already sets `trust proxy`, Helmet headers, a CSP, and a 1 MB request-body cap.

## 5. Keep secrets out of git

`web/backend/.env` and the cookie files are already in `.gitignore` — keep them there. dependency scanning (`npm audit` + OSV-Scanner) runs in CI; for live malicious-package alerts, enable the Socket GitHub App.

for how to report a vulnerability, see [`../SECURITY.md`](../SECURITY.md).
