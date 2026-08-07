import { supabase, isSupabaseConfigured } from './supabase';
import type { InboxItem, InboxType } from './notifications.logic';

export type { InboxItem } from './notifications.logic';
export { badgeLabel, notificationAction } from './notifications.logic';

type Row = {
  id: string;
  type: InboxType;
  actor_name: string | null;
  actor_avatar: string | null;
  update_id: string | null;
  comment_id: string | null;
  preview: string | null;
  read_at: string | null;
  created_at: string;
};

function client() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

function mapRow(row: Row): InboxItem {
  return {
    id: row.id,
    type: row.type,
    actorName: row.actor_name ?? 'Someone',
    actorAvatar: row.actor_avatar,
    updateId: row.update_id,
    commentId: row.comment_id,
    preview: row.preview ?? '',
    createdAt: row.created_at,
    read: row.read_at != null,
  };
}

// rls-scoped to recipient. degrades to empty on error.
export async function listNotifications(): Promise<InboxItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await client()
    .from('notifications')
    .select(
      'id, type, actor_name, actor_avatar, update_id, comment_id, preview, read_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapRow);
}

export async function unreadCount(): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  const { count, error } = await client()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

export async function markAllRead(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await client()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
}

let inboxChannelSeq = 0;

export function subscribeToNotifications(onChange: () => void): () => void {
  if (!supabase) return () => undefined;
  const sb = supabase;
  // unique name per subscriber — the bell badge & the open inbox panel both
  // subscribe at once; a shared channel name throws "add callbacks after
  // subscribe()" on the second one.
  inboxChannelSeq += 1;
  const channel = sb
    .channel(`notifications-inbox-${inboxChannelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      onChange
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
