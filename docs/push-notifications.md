# Push notifications

the Updates tab has a second, separate pipeline from the download flow: **push notifications**. when someone replies to your comment, @mentions you, likes your comment, or the creator posts a new update, a notification lands on your phone — even with the app closed — and a matching row is written to the in-app inbox behind the bell badge.

it's built on **FCM** (Firebase Cloud Messaging) with a **Supabase Edge Function** (`send-push`) as the server. the function is triggered by Database Webhooks on INSERT, figures out who to notify, writes the inbox rows, and sends the pushes. the service-account key lives only in the function's secrets, never in the app.

this guide covers the **setup and architecture** — the parts that aren't visible in the code. the line-level "why" stays in the source comments, so nothing here is duplicated there.

## How it works

a write to `comments`, `comment_likes`, or `updates` fires a webhook, and the flow from there is:

```text
INSERT (comment / like / update)
   │  Database Webhook → POST /functions/v1/send-push  (x-webhook-secret header)
   ▼
send-push  (Deno Edge Function)
   ├─ resolve recipients   — reply > mention > comment precedence, actor never notifies self
   ├─ drop the muted        — profiles.notif_social off = skip
   ├─ write inbox rows      — public.notifications  (realtime → bell badge)
   └─ send FCM v1 push      — one per device token; dead tokens get pruned
```

personal events (reply / mention / like / comment) send one message per recipient device. a new update instead broadcasts once to the `updates` topic, which every install subscribes to on first launch. tokens that FCM reports as dead are deleted from `device_tokens` on the way out.

on the device, foreground messages render through `src/lib/social/push.ts`, background ones through the handler in `index.ts`, and taps deep-link to the right comment via `src/lib/social/pushRender.ts`.

## The pieces

the function is three files, split so the logic stays testable off the Deno runtime:

| File       | Role                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| `index.ts` | the handler — checks the secret, routes by table, runs the lookups and dispatch        |
| `logic.ts` | pure logic (recipients, mutes, titles, preview) — unit-tested under vitest             |
| `fcm.ts`   | FCM v1 transport — signs a service-account JWT, exchanges it for an OAuth token, sends |

the tables live in [`../mobile/supabase/schema.sql`](../mobile/supabase/schema.sql):

- **`device_tokens`** — one row per device (`user_id → token`, unique). RLS is owner-only; the service role reads them all to send.
- **`notifications`** — the inbox, one row per personal event. owner-only read/update/delete, and **insert is service-role only** (no client can forge a notification). it's in the `supabase_realtime` publication so the badge updates live.
- **`profiles.notif_social`** — a single boolean (default on) behind the "Social notifications" toggle in Settings. `send-push` checks it before writing anything.

## Setup

### Firebase

the project is `panther-87d1b`. from **Project settings → Service accounts → Generate new private key** you get a JSON with `project_id`, `client_email`, and `private_key` — those three feed the secrets below. `google-services.json` at the app root is the client config (not a secret).

### secrets

set these in Supabase → Edge Functions → `send-push` → Secrets:

```text
FCM_PROJECT_ID       panther-87d1b
FCM_CLIENT_EMAIL     <service account client_email>
FCM_PRIVATE_KEY      <service account private_key, pasted verbatim — literal \n is handled>
PUSH_WEBHOOK_SECRET  <any long random string, shared with the webhooks below>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the platform — you don't set those.

### deploy

```bash
supabase functions deploy send-push --no-verify-jwt
```

**Verify JWT must be off** — the function authenticates with the `x-webhook-secret` header, not a user token, so leaving JWT verification on would reject every webhook.

### webhooks

create three in Supabase → Database → Webhooks. all three are **INSERT**, method `POST`, pointed at the function URL, with the header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`:

| Name                 | Table                  |
| -------------------- | ---------------------- |
| `push-comments`      | `public.comments`      |
| `push-comment-likes` | `public.comment_likes` |
| `push-updates`       | `public.updates`       |

the URL is `https://<project-ref>.supabase.co/functions/v1/send-push`.

### the client side

push uses native Firebase modules (`@react-native-firebase/app` + `/messaging`), so it's **not** an OTA change — touching it needs a fresh dev-client / EAS build:

```bash
eas build --profile development --platform android
```

the token lifecycle (register on sign-in, refresh, delete on sign-out) lives in `src/lib/social/push.ts`.

## Testing

the pure logic is covered by [`../mobile/tests/send-push.logic.test.ts`](../mobile/tests/send-push.logic.test.ts) (vitest, node env). the Deno files (`index.ts`, `fcm.ts`) are excluded from the app's `tsc`/`eslint` and validated by Deno at deploy time instead.

## Notes

- a warm function delivers in ~1–3s; a cold start can take up to ~10s before the first push lands.
- `notif_social` off mutes **every** social type for that user, creator comment pings included.
- how the app name and avatar render on the notification varies by Android OEM — that's cosmetic, not a bug.
- the private key lives only in the Edge Function secrets — never commit it or echo it back.
