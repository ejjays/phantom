/*
 * send-push — invoked by Supabase Database Webhooks on INSERT into comments,
 * comment_likes and updates. resolves who to notify, writes in-app inbox rows,
 * and sends FCM v1 pushes (per-token for personal events, one topic broadcast
 * for new updates). service-account secret lives only in Edge Function secrets.
 *
 * setup (one-time):
 *   1. supabase functions deploy send-push  (Verify JWT OFF — auth is the shared secret checked below)
 *   2. set secrets: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (paste the
 * service account private_key verbatim — \n escapes are handled),
 * PUSH_WEBHOOK_SECRET (any long random string)
 *   3. dashboard -> Database -> Webhooks -> create 3 webhooks (INSERT) on
 *  public.comments, public.comment_likes, public.updates, each POSTing to
 *  the function URL with header  x-webhook-secret: <PUSH_WEBHOOK_SECRET>
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildNotifyKitPayload } from 'npm:react-native-notify-kit@10.4.6/server';
import {
  buildSocialNotification,
  buildUpdateNotification,
  collapseKeyFor,
  isMuted,
  parseMentions,
  previewText,
  resolveCommentRecipients,
  resolveLikeRecipients,
  type MuteFlags,
  type Recipient,
  type SocialNotification,
} from './logic.ts';
import { getAccessToken, sendMessage, type ServiceAccount } from './fcm.ts';

type CommentRecord = {
  id: string;
  update_id: string;
  user_id: string;
  body: string | null;
  parent_id: string | null;
  gif_url: string | null;
  image_url: string | null;
};
type LikeRecord = { id: string; comment_id: string; user_id: string };
type UpdateRecord = {
  id: string;
  title: string;
  category: string;
  image_url: string | null;
};
type WebhookBody = {
  type: string;
  table: string;
  record: Record<string, unknown>;
};

type ActorProfile = { username: string; avatar_url: string | null };

type DispatchContext = {
  actorId: string;
  actorName: string;
  actorAvatar: string | null;
  updateId: string;
  commentId: string;
  preview: string;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function serviceAccount(): ServiceAccount {
  return {
    projectId: Deno.env.get('FCM_PROJECT_ID') ?? '',
    clientEmail: Deno.env.get('FCM_CLIENT_EMAIL') ?? '',
    // secrets store the key with literal \n — restore real newlines for PEM.
    privateKey: (Deno.env.get('FCM_PRIVATE_KEY') ?? '').replace(/\\n/gu, '\n'),
  };
}

async function fetchActor(
  sb: SupabaseClient,
  userId: string
): Promise<ActorProfile | null> {
  const { data } = await sb
    .from('profiles')
    .select('username, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  return (data as ActorProfile | null) ?? null;
}

async function fetchParentAuthor(
  sb: SupabaseClient,
  parentId: string | null
): Promise<string | null> {
  if (!parentId) return null;
  const { data } = await sb
    .from('comments')
    .select('user_id')
    .eq('id', parentId)
    .maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

async function fetchMentionedIds(
  sb: SupabaseClient,
  handles: string[]
): Promise<string[]> {
  if (handles.length === 0) return [];
  const { data } = await sb
    .from('profiles')
    .select('id')
    .in('username', handles);
  return (data ?? []).map((row: { id: string }) => row.id);
}

async function fetchCreatorIds(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb
    .from('profiles')
    .select('id')
    .eq('is_creator', true);
  return (data ?? []).map((row: { id: string }) => row.id);
}

// shared tail: mute-filter, write inbox rows, push to each recipient's tokens,
// prune tokens FCM rejects.
async function dispatch(
  sb: SupabaseClient,
  sa: ServiceAccount,
  recipients: Recipient[],
  ctx: DispatchContext
): Promise<void> {
  const ids = recipients.map((entry) => entry.userId);
  const { data: flagRows } = await sb
    .from('profiles')
    .select('id, notif_social')
    .in('id', ids);
  const flags = new Map<string, MuteFlags>(
    (flagRows ?? []).map((row: MuteFlags & { id: string }) => [row.id, row])
  );

  const allowed = recipients.filter((entry) => {
    const flag = flags.get(entry.userId);
    return flag ? !isMuted(entry.type, flag) : true;
  });
  if (allowed.length === 0) return;

  // inbox write & token lookup are independent — run together.
  const [, tokenRes] = await Promise.all([
    sb.from('notifications').insert(
      allowed.map((entry) => ({
        recipient_id: entry.userId,
        type: entry.type,
        actor_id: ctx.actorId,
        actor_name: ctx.actorName,
        actor_avatar: ctx.actorAvatar,
        update_id: ctx.updateId,
        comment_id: ctx.commentId,
        preview: ctx.preview,
      }))
    ),
    sb
      .from('device_tokens')
      .select('user_id, token')
      .in(
        'user_id',
        allowed.map((entry) => entry.userId)
      ),
  ]);
  const tokenRows = tokenRes.data;
  if (!tokenRows || tokenRows.length === 0) return;

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokenRows as { user_id: string; token: string }[]) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row.token);
    tokensByUser.set(row.user_id, list);
  }

  const accessToken = await getAccessToken(sa);
  // fan out all sends in parallel; collect tokens FCM rejects for pruning.
  const sends: Promise<{ token: string; result: string }>[] = [];
  for (const entry of allowed) {
    const notification: SocialNotification = buildSocialNotification({
      type: entry.type,
      actorName: ctx.actorName,
      actorAvatar: ctx.actorAvatar,
      preview: ctx.preview,
      updateId: ctx.updateId,
      commentId: ctx.commentId,
    });
    const collapseKey = collapseKeyFor(entry.type, ctx.commentId);
    for (const token of tokensByUser.get(entry.userId) ?? []) {
      const message = buildNotifyKitPayload({
        token,
        notification,
        options: {
          androidPriority: 'high',
          ...(collapseKey ? { collapseKey } : {}),
        },
      });
      sends.push(
        sendMessage(sa.projectId, accessToken, message).then((result) => ({
          token,
          result,
        }))
      );
    }
  }
  const results = await Promise.all(sends);
  const invalid = results
    .filter((entry) => entry.result === 'invalid-token')
    .map((entry) => entry.token);
  if (invalid.length > 0) {
    await sb.from('device_tokens').delete().in('token', invalid);
  }
}

async function handleComment(
  sb: SupabaseClient,
  sa: ServiceAccount,
  record: CommentRecord
): Promise<void> {
  // independent lookups run in parallel to shave delivery latency.
  const handles = parseMentions(record.body ?? '');
  const [actor, parentAuthorId, mentionedUserIds, creatorIds] =
    await Promise.all([
      fetchActor(sb, record.user_id),
      fetchParentAuthor(sb, record.parent_id),
      fetchMentionedIds(sb, handles),
      fetchCreatorIds(sb),
    ]);
  if (!actor) return;

  const recipients = resolveCommentRecipients({
    actorId: record.user_id,
    parentAuthorId,
    mentionedUserIds,
    creatorIds,
  });
  if (recipients.length === 0) return;

  await dispatch(sb, sa, recipients, {
    actorId: record.user_id,
    actorName: actor.username ?? 'Anonymous',
    actorAvatar: actor.avatar_url,
    updateId: record.update_id,
    commentId: record.id,
    preview: previewText({
      body: record.body,
      gifUrl: record.gif_url,
      imageUrl: record.image_url,
    }),
  });
}

async function handleLike(
  sb: SupabaseClient,
  sa: ServiceAccount,
  record: LikeRecord
): Promise<void> {
  const [actor, commentRes] = await Promise.all([
    fetchActor(sb, record.user_id),
    sb
      .from('comments')
      .select('user_id, update_id, body, gif_url, image_url')
      .eq('id', record.comment_id)
      .maybeSingle(),
  ]);
  if (!actor) return;
  const comment = commentRes.data;
  if (!comment) return;
  const row = comment as {
    user_id: string;
    update_id: string;
    body: string | null;
    gif_url: string | null;
    image_url: string | null;
  };

  const recipients = resolveLikeRecipients({
    actorId: record.user_id,
    commentAuthorId: row.user_id,
  });
  if (recipients.length === 0) return;

  await dispatch(sb, sa, recipients, {
    actorId: record.user_id,
    actorName: actor.username ?? 'Anonymous',
    actorAvatar: actor.avatar_url,
    updateId: row.update_id,
    commentId: record.comment_id,
    preview: previewText({
      body: row.body,
      gifUrl: row.gif_url,
      imageUrl: row.image_url,
    }),
  });
}

async function handleUpdate(
  sb: SupabaseClient,
  sa: ServiceAccount,
  record: UpdateRecord
): Promise<void> {
  const { data: creator } = await sb
    .from('profiles')
    .select('avatar_url')
    .eq('is_creator', true)
    .limit(1)
    .maybeSingle();
  const notification = buildUpdateNotification({
    category: record.category,
    title: record.title,
    creatorAvatar:
      (creator as { avatar_url: string | null } | null)?.avatar_url ?? null,
    imageUrl: record.image_url,
    updateId: record.id,
  });
  const accessToken = await getAccessToken(sa);
  const message = buildNotifyKitPayload({
    topic: 'updates',
    notification,
    options: { androidPriority: 'high' },
  });
  await sendMessage(sa.projectId, accessToken, message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = req.headers.get('x-webhook-secret');
  if (!secret || secret !== Deno.env.get('PUSH_WEBHOOK_SECRET')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  const sa = serviceAccount();
  const payload = (await req.json()) as WebhookBody;
  if (payload.type !== 'INSERT') return json({ skipped: 'not-insert' });

  try {
    if (payload.table === 'comments') {
      await handleComment(sb, sa, payload.record as unknown as CommentRecord);
    } else if (payload.table === 'comment_likes') {
      await handleLike(sb, sa, payload.record as unknown as LikeRecord);
    } else if (payload.table === 'updates') {
      await handleUpdate(sb, sa, payload.record as unknown as UpdateRecord);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('[send-push]', err);
    return json({ error: String(err) }, 500);
  }
});
