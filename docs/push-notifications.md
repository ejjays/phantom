# Push Notifications

The Updates tab has a second pipeline separate from downloads: **push notifications**. When someone replies to your comment, @mentions you, likes your comment, or the creator posts a new update, a notification lands on your phone — even with the app closed — and a matching row appears in the in-app inbox behind the bell badge.

Built on **FCM** (Firebase Cloud Messaging) with a **Supabase Edge Function** (`send-push`) as the server. The function is triggered by Database Webhooks on INSERT, figures out who to notify, writes the inbox rows, and sends the pushes. The service-account key lives only in the function's secrets, never in the app.

## How It Works

A write to `comments`, `comment_likes`, or `updates` fires a webhook:

```
INSERT (comment / like / update)
   │  Database Webhook → POST /functions/v1/send-push  (x-webhook-secret header)
   ▼
send-push (Deno Edge Function)
   ├─ resolve recipients   — reply > mention > comment precedence, actor never notifies self
   ├─ drop the muted        — profiles.notif_social off = skip
   ├─ write inbox rows      — public.notifications (realtime → bell badge)
   └─ send FCM v1 push      — one per device token; dead tokens pruned
```

Personal events (reply / mention / like / comment) send one message per recipient device. A new update broadcasts once to the `updates` topic, which every install subscribes to on first launch. Tokens FCM reports as dead are deleted from `device_tokens` on the way out.

On device, foreground messages render through `src/lib/social/push.ts`, background through the handler in `index.ts`, and taps deep-link to the right comment via `src/lib/social/pushRender.ts`.

## The Pieces

The function is three files, split so logic stays testable off the Deno runtime:

| File       | Role                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| `index.ts` | Handler — checks secret, routes by table, runs lookups and dispatch            |
| `logic.ts` | Pure logic (recipients, mutes, titles, preview) — unit-tested under vitest     |
| `fcm.ts`   | FCM v1 transport — signs service-account JWT, exchanges for OAuth token, sends |

Tables live in [`../mobile/supabase/schema.sql`](../mobile/supabase/schema.sql):

- **`device_tokens`** — one row per device (`user_id → token`, unique). RLS owner-only; service role reads all to send.
- **`notifications`** — the inbox, one row per personal event. Owner-only read/update/delete; **insert is service-role only** (no client can forge a notification). In `supabase_realtime` publication so badge updates live.
- **`profiles.notif_social`** — single boolean (default on) behind the "Social notifications" toggle in Settings. `send-push` checks it before writing anything.

## Setup

### Firebase

Project is `panther-87d1b`. From **Project settings → Service accounts → Generate new private key** you get a JSON with `project_id`, `client_email`, and `private_key` — those three feed the secrets below. `google-services.json` at the app root is the client config (not a secret).

### Secrets

Set these in Supabase → Edge Functions → `send-push` → Secrets:

```
FCM_PROJECT_ID       panther-87d1b
FCM_CLIENT_EMAIL     <service account client_email>
FCM_PRIVATE_KEY      <service account private_key, pasted verbatim — literal \n is handled>
PUSH_WEBHOOK_SECRET  <any long random string, shared with the webhooks below>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the platform — you don't set those.

### Deploy

```bash
supabase functions deploy send-push --no-verify-jwt
```

**Verify JWT must be off** — the function authenticates with the `x-webhook-secret` header, not a user token, so leaving JWT verification on would reject every webhook.

### Webhooks

Create three in Supabase → Database → Webhooks. All three are **INSERT**, method `POST`, pointed at the function URL, with header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`:

| Name                 | Table                  |
| -------------------- | ---------------------- |
| `push-comments`      | `public.comments`      |
| `push-comment-likes` | `public.comment_likes` |
| `push-updates`       | `public.updates`       |

URL is `https://<project-ref>.supabase.co/functions/v1/send-push`.

### Client Side

Push uses native Firebase modules (`@react-native-firebase/app` + `/messaging`), so it's **not** an OTA change — touching it needs a fresh dev-client / EAS build:

```bash
eas build --profile development --platform android
```

Token lifecycle (register on sign-in, refresh, delete on sign-out) lives in `src/lib/social/push.ts`.

## Testing

Pure logic covered by [`../mobile/tests/send-push.logic.test.ts`](../mobile/tests/send-push.logic.test.ts) (vitest, node env). The Deno files (`index.ts`, `fcm.ts`) are excluded from the app's `tsc`/`eslint` and validated by Deno at deploy time instead.

## Notes

- Warm function delivers in ~1–3s; cold start can take up to ~10s before the first push lands.
- `notif_social` off mutes **every** social type for that user, creator comment pings included.
- How the app name and avatar render on the notification varies by Android OEM — cosmetic, not a bug.
- The private key lives only in the Edge Function secrets — never commit it or echo it back.
