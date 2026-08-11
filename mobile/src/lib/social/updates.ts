import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { isPresetMarker, presetMarker } from '../avatars.logic';
import { randomPresetMarker } from '../avatars';
import {
  planReactionToggle,
  generateGuestName,
  type Update,
  type UpdateCategory,
  type UpdateComment,
  type ReactionRow,
} from './updates.logic';

export {
  summarizeReactions,
  planReactionToggle,
  validateUsername,
  validateComment,
  suggestUsernameFrom,
  isGuestName,
  displayName,
  relativeTime,
  messageOf,
  type Update,
  type UpdateCategory,
  type UpdateComment,
  type ReactionRow,
  type ReactionTally,
} from './updates.logic';
export { isSupabaseConfigured } from './supabase';

type ProfileRow = {
  username: string;
  avatar_url: string | null;
  is_creator?: boolean;
};
type ProfileRef = ProfileRow | ProfileRow[] | null;

function googleFieldsOf(user: User): {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
} {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  return {
    name: str(meta.full_name) ?? str(meta.name),
    email: str(user.email),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
}

class NotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured');
    this.name = 'NotConfiguredError';
  }
}

function client() {
  if (!supabase) throw new NotConfiguredError();
  return supabase;
}

function pickProfile(ref: ProfileRef): {
  username: string;
  avatarUrl: string | null;
  creator: boolean;
} {
  if (!ref) return { username: 'anon', avatarUrl: null, creator: false };
  const row = Array.isArray(ref) ? ref[0] : ref;
  return {
    username: row?.username ?? 'anon',
    avatarUrl: row?.avatar_url ?? null,
    creator: !!row?.is_creator,
  };
}

export async function getExistingUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await client().auth.getSession();
  return data.session?.user.id ?? null;
}

export async function ensureSession(): Promise<string> {
  const { data } = await client().auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error('Sign in to react or comment');
  if (user.is_anonymous) await ensureGuestProfile(user.id);
  return user.id;
}

export async function signInAsGuest(): Promise<string> {
  const { data, error } = await client().auth.signInAnonymously();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('Anonymous sign-in returned no user');
  await ensureGuestProfile(userId);
  return userId;
}

// idempotent: only creates the row when missing, so a stale session never
// regenerates (and clobbers) an existing guest name.
async function ensureGuestProfile(userId: string): Promise<void> {
  const { data, error: readError } = await client()
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw readError;
  if (data) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await client().from('profiles').upsert({
      id: userId,
      username: generateGuestName(),
      avatar_url: randomPresetMarker(),
    });
    if (!error) return;
    if (error.code === '23505') continue;
    throw error;
  }
  throw new Error('Could not pick an anonymous handle');
}

// repairs the profile before flows that hit the profiles FK (e.g. push token
// upsert); no-op for google/other users.
export async function ensureGuestReady(userId: string): Promise<void> {
  const { data } = await client().auth.getSession();
  if (!data.session?.user?.is_anonymous) return;
  await ensureGuestProfile(userId);
}

export async function fetchUsername(userId: string): Promise<string | null> {
  const { data, error } = await client()
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { username: string } | null;
  return row?.username ?? null;
}

export async function fetchProfile(
  userId: string
): Promise<{ username: string | null; avatarUrl: string | null } | null> {
  const { data, error } = await client()
    .from('profiles')
    .select('username, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as ProfileRow | null;
  if (!row) return null;
  return { username: row.username ?? null, avatarUrl: row.avatar_url ?? null };
}

export async function setUsername(username: string): Promise<string> {
  const userId = await ensureSession();
  const avatar_url = randomPresetMarker();
  const { error } = await client()
    .from('profiles')
    .upsert({ id: userId, username, avatar_url });
  if (error) throw error;
  return userId;
}

export type Account = {
  userId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
};

export async function getAccount(): Promise<Account | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await client().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = await fetchProfile(user.id);
  if (user.is_anonymous) {
    return {
      userId: user.id,
      username: profile?.username ?? null,
      name: null,
      email: null,
      avatarUrl: profile?.avatarUrl ?? null,
      isGuest: true,
    };
  }
  const google = googleFieldsOf(user);
  return {
    userId: user.id,
    username: profile?.username ?? null,
    name: google.name,
    email: google.email,
    avatarUrl: profile?.avatarUrl ?? google.avatarUrl,
    isGuest: false,
  };
}

export async function getMyAvatarUrl(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await client().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  if (user.is_anonymous) {
    // guest avatar lives in the profile row (presets); google avatar n/a
    const profile = await fetchProfile(user.id);
    return profile?.avatarUrl ?? null;
  }
  return googleFieldsOf(user).avatarUrl;
}

export async function syncProfileAvatar(): Promise<void> {
  const avatarUrl = await getMyAvatarUrl();
  if (!avatarUrl) return;
  const userId = await getExistingUserId();
  if (!userId) return;
  const profile = await fetchProfile(userId);
  if (isPresetMarker(profile?.avatarUrl)) return; // keep a user-chosen preset
  await client()
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);
}

export async function changeUsername(
  username: string
): Promise<'ok' | 'taken'> {
  const userId = await getExistingUserId();
  if (!userId) throw new Error('Not signed in');
  // omit avatar_url so a chosen avatar survives a rename (upsert leaves it)
  const { error } = await client()
    .from('profiles')
    .upsert({ id: userId, username });
  if (!error) return 'ok';
  if (error.code === '23505') return 'taken';
  throw error;
}

export async function setPresetAvatar(id: string): Promise<void> {
  const userId = await getExistingUserId();
  if (!userId) throw new Error('Not signed in');
  const { error } = await client()
    .from('profiles')
    .update({ avatar_url: presetMarker(id) })
    .eq('id', userId);
  if (error) throw error;
}

export async function getSocialNotify(): Promise<boolean> {
  const userId = await getExistingUserId();
  if (!userId) return true;
  const { data, error } = await client()
    .from('profiles')
    .select('notif_social')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return true;
  return (data as { notif_social: boolean | null }).notif_social ?? true;
}

export async function setSocialNotify(value: boolean): Promise<void> {
  const userId = await getExistingUserId();
  if (!userId) return;
  const { error } = await client()
    .from('profiles')
    .update({ notif_social: value })
    .eq('id', userId);
  if (error) throw error;
}

export function onAuthChange(handler: () => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange(() => handler());
  return () => data.subscription.unsubscribe();
}

export async function listUpdates(): Promise<Update[]> {
  const { data, error } = await client()
    .from('updates')
    .select('id, version, title, body, category, published_at, image_url')
    .order('published_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    version: string | null;
    title: string;
    body: string;
    category: UpdateCategory;
    published_at: string;
    image_url: string | null;
  };
  const rows = (data ?? []) as Row[];
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    body: row.body,
    category: row.category,
    publishedAt: row.published_at,
    imageUrl: row.image_url,
  }));
}

export async function listReactions(
  updateIds: string[]
): Promise<ReactionRow[]> {
  if (updateIds.length === 0) return [];
  const { data, error } = await client()
    .from('reactions')
    .select('update_id, emoji, user_id')
    .in('update_id', updateIds);
  if (error) throw error;
  type Row = { update_id: string; emoji: string; user_id: string };
  const rows = (data ?? []) as Row[];
  return rows.map((row) => ({
    updateId: row.update_id,
    emoji: row.emoji,
    userId: row.user_id,
  }));
}

// per-update comment totals; degrades to empty on error so a count hiccup
// never blanks the feed.
export async function listCommentCounts(
  updateIds: string[]
): Promise<Record<string, number>> {
  if (updateIds.length === 0) return {};
  const { data, error } = await client()
    .from('comments')
    .select('update_id')
    .in('update_id', updateIds);
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { update_id: string }[]) {
    counts[row.update_id] = (counts[row.update_id] ?? 0) + 1;
  }
  return counts;
}

export async function toggleReaction(
  updateId: string,
  emoji: string,
  rows: ReactionRow[]
): Promise<'insert' | 'delete'> {
  const userId = await ensureSession();
  const action = planReactionToggle(rows, updateId, emoji, userId);
  if (action === 'insert') {
    const { error } = await client()
      .from('reactions')
      .insert({ update_id: updateId, emoji, user_id: userId });
    if (error) throw error;
    return action;
  }
  const { error } = await client()
    .from('reactions')
    .delete()
    .eq('update_id', updateId)
    .eq('emoji', emoji)
    .eq('user_id', userId);
  if (error) throw error;
  return action;
}

const commentsCache = new Map<string, UpdateComment[]>();

// cached per post — reopen paints instantly, then refreshes in bg
export function cachedComments(updateId: string): UpdateComment[] {
  return commentsCache.get(updateId) ?? [];
}

export function cacheComments(updateId: string, list: UpdateComment[]): void {
  commentsCache.set(updateId, list);
}

export async function listComments(updateId: string): Promise<UpdateComment[]> {
  const userId = await getExistingUserId();
  const { data, error } = await client()
    .from('comments')
    .select(
      'id, update_id, body, gif_url, image_url, created_at, user_id, parent_id, profiles(username, avatar_url, is_creator)'
    )
    .eq('update_id', updateId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    update_id: string;
    body: string;
    gif_url: string | null;
    image_url: string | null;
    created_at: string;
    user_id: string;
    parent_id: string | null;
    profiles: ProfileRef;
  };
  const rows = (data ?? []) as Row[];
  const likes = await fetchCommentLikes(
    rows.map((row) => row.id),
    userId
  );
  return rows.map((row) => {
    const profile = pickProfile(row.profiles);
    const like = likes.get(row.id);
    return {
      id: row.id,
      updateId: row.update_id,
      body: row.body,
      createdAt: row.created_at,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      mine: row.user_id === userId,
      parentId: row.parent_id,
      likeCount: like?.count ?? 0,
      liked: like?.mine ?? false,
      gifUrl: row.gif_url,
      imageUrl: row.image_url,
      creator: profile.creator,
    };
  });
}

// degrades to empty if comment_likes table not migrated yet
async function fetchCommentLikes(
  commentIds: string[],
  userId: string | null
): Promise<Map<string, { count: number; mine: boolean }>> {
  const out = new Map<string, { count: number; mine: boolean }>();
  if (commentIds.length === 0) return out;
  const { data, error } = await client()
    .from('comment_likes')
    .select('comment_id, user_id')
    .in('comment_id', commentIds);
  if (error || !data) return out;
  for (const like of data as { comment_id: string; user_id: string }[]) {
    const entry = out.get(like.comment_id) ?? { count: 0, mine: false };
    entry.count += 1;
    if (like.user_id === userId) entry.mine = true;
    out.set(like.comment_id, entry);
  }
  return out;
}

export async function likeComment(commentId: string): Promise<void> {
  const userId = await ensureSession();
  const { error } = await client()
    .from('comment_likes')
    .insert({ comment_id: commentId, user_id: userId });
  if (error) throw error;
}

export async function unlikeComment(commentId: string): Promise<void> {
  const userId = await ensureSession();
  const { error } = await client()
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function addComment(
  updateId: string,
  body: string,
  parentId: string | null = null,
  id?: string,
  gifUrl: string | null = null,
  imageUrl: string | null = null
): Promise<void> {
  const userId = await ensureSession();
  const { error } = await client()
    .from('comments')
    .insert({
      ...(id ? { id } : {}),
      update_id: updateId,
      body,
      user_id: userId,
      parent_id: parentId,
      gif_url: gifUrl,
      image_url: imageUrl,
    });
  if (error) throw error;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await client()
    .from('comments')
    .delete()
    .eq('id', commentId);
  if (error) throw error;
}

export async function editComment(
  commentId: string,
  body: string
): Promise<void> {
  const { error } = await client()
    .from('comments')
    .update({ body })
    .eq('id', commentId);
  if (error) throw error;
}

// no update_id filter — DELETE payloads carry only PK, so a filtered sub would
// silently drop deletes; caller refetches on any change.
type RtChannel = ReturnType<NonNullable<typeof supabase>['channel']>;
const liveChannels = new Map<string, RtChannel>();

function realtimeTables(
  channelName: string,
  tables: readonly string[],
  onChange: () => void
): () => void {
  if (!supabase) return () => undefined;
  const sb = supabase;
  // rapid reopen can leave prior same-name channel mid-teardown — dupe doubles
  // realtime traffic & churns JS thread, so drop any stale one first
  const stale = liveChannels.get(channelName);
  if (stale) void sb.removeChannel(stale);
  let chan = sb.channel(channelName);
  for (const table of tables) {
    chan = chan.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      onChange
    );
  }
  const channel = chan.subscribe();
  liveChannels.set(channelName, channel);
  return () => {
    if (liveChannels.get(channelName) === channel) {
      liveChannels.delete(channelName);
    }
    void sb.removeChannel(channel);
  };
}

export function subscribeToComments(
  updateId: string,
  onChange: () => void
): () => void {
  return realtimeTables(
    `comments-${updateId}`,
    ['comments', 'comment_likes'],
    onChange
  );
}

export function subscribeToFeed(onChange: () => void): () => void {
  return realtimeTables(
    'updates-feed',
    ['updates', 'reactions', 'comments'],
    onChange
  );
}
