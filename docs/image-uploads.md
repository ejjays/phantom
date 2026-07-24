# Comment image uploads

people can attach an image to a comment in the Updates tab. the file never touches a server — the app compresses it on-device, uploads it straight to **Cloudflare R2**, and stores a public URL in `comments.image_url`. those images are served back through a small **Cloudflare Pages Function**, not R2's public dev URL.

this doc covers the flow and the one-time setup. the reason it's built this way — R2's free egress plus a serving path that isn't rate-limited — is the whole point, so it's worth reading before touching any of it.

## How it works

```text
pick image (gallery)
   │  expo-image-picker
   ▼
compress on-device        src/lib/social/commentImage.ts
   │  ffmpeg → webp, longest edge capped at 1080, q80 (~10x smaller)
   ▼
ask for a presigned PUT   supabase fn: r2-upload-url  (10 min ttl, rejects anon)
   │
   ▼
PUT bytes → R2            react-native-blob-util, streamed from disk (no RAM buffer)
   │
   ▼
store publicUrl          comments.image_url  = https://panther-downloader.pages.dev/i/comments/<uid>/<uuid>.webp
```

the temp webp is deleted in a `finally` even if the upload fails, so nothing is left in the cache. on failure the composer rolls back the optimistic comment and restores your text + pending image, so nothing is lost.

## Why a Pages Function, not r2.dev

R2 will hand you a `pub-*.r2.dev` public URL, but Cloudflare's own docs say it's **not for production and has a variable rate limit** — under real traffic it starts returning 429s and images flicker blank. instead the bucket stays **private**, and a Pages Function bound to it serves the bytes from our own `panther-downloader.pages.dev` domain:

- no rate limit — it's our Worker, not r2.dev
- R2 egress is free, so image bandwidth never touches Supabase's ~10 GB/month
- Cloudflare edge-caches each image (keys are immutable), so R2 is barely hit
- no custom domain to buy

the function lives in the **frontend** repo at [`web/frontend/functions/i/[[path]].ts`](../web/frontend/functions/i/[[path]].ts). it only serves `comments/*.webp` keys, so it can't be used to probe the rest of the bucket.

## Setup

### R2 bucket + token

1. R2 → create a bucket (`panther-uploads`), Standard class. **keep it private** — no public access needed.
2. R2 → Manage API Tokens → create an **Account API Token** with Object Read & Write, scoped to that bucket. copy the Access Key ID + Secret (the secret is shown once).

### the upload function (Supabase)

deploy `r2-upload-url` (dashboard editor or `supabase functions deploy r2-upload-url`) with **Verify JWT off** — it authenticates the caller in-code and rejects anonymous sessions. set five secrets:

```text
R2_ACCOUNT_ID          your Cloudflare account id
R2_BUCKET              panther-uploads
R2_ACCESS_KEY_ID       from the API token
R2_SECRET_ACCESS_KEY   from the API token
R2_PUBLIC_BASE         https://panther-downloader.pages.dev/i
```

### the serving function (Cloudflare Pages)

1. Cloudflare → your Pages project → Settings → Functions → **R2 bindings** → add a binding: variable name `UPLOADS` → bucket `panther-uploads`.
2. the function file (`functions/i/[[path]].ts`) is already in the frontend repo, so the next Pages deploy picks it up. it serves `https://panther-downloader.pages.dev/i/comments/...`.

that's it — new uploads use the Pages URL immediately.

### the delete function (Cloudflare Pages + Supabase webhook)

when a comment (or its row's parent via cascade) is deleted, a Supabase database webhook posts to another Pages Function that drops the R2 object. this catches direct deletes and cascades (profile → comments), so nothing orphans in R2.

1. Cloudflare → the Pages project → Settings → Variables and Secrets → add a **secret** `WEBHOOK_SECRET` (any long random string — `openssl rand -hex 32`). the `UPLOADS` R2 binding from the serving function is reused, no changes needed.
2. the function file (`functions/comment-deleted.ts`) is already in the frontend repo; the next Pages deploy picks it up. its route is `https://panther-downloader.pages.dev/comment-deleted`.
3. Supabase → Database → **Webhooks** → Create a webhook:
   - Name: `r2-comment-cleanup`
   - Table: `public.comments`, Event: **Delete**
   - Type: **HTTP Request**, Method: **POST**
   - URL: `https://panther-downloader.pages.dev/comment-deleted`
   - HTTP Headers: add `X-Webhook-Secret` with the same value set in step 1

verify by deleting a test comment that has an image — the row goes, the R2 object goes with it. wrong-event or bad-key payloads still return 200 so Supabase doesn't retry pointlessly.

## Migrating existing URLs

if any images were already stored against the old `r2.dev` base, rewrite them once in the SQL Editor. this rebuilds each URL from the `comments/…` key, so you don't need to paste the old base:

```sql
update public.comments
set image_url = 'https://panther-downloader.pages.dev/i/' ||
                substring(image_url from 'comments/.*$')
where image_url is not null
  and image_url like '%/comments/%'
  and image_url not like 'https://panther-downloader.pages.dev/i/%';
```

## Notes

- images are immutable (keyed by random uuid), so they're cached `max-age=31536000, immutable` — an edit uploads a new object rather than overwriting.
- deleting a comment triggers a Supabase database webhook that hits [`comment-deleted`](../web/frontend/functions/comment-deleted.ts), which parses the row's `image_url` & drops the R2 object. cascades (profile → comments) fire the webhook too, so orphans don't accumulate.
- the R2 secret keys live only in the `r2-upload-url` function secrets — never in the app.
