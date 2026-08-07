/*
 * pure logic: no Deno/network/npm imports — vitest-testable. constants mirror
 *  client's pushRender.logic.ts (separate runtimes, not shared).
 */

export type SocialType = 'reply' | 'mention' | 'like' | 'comment';

// android notification config subset accepted by notify-kit's buildNotifyKitPayload.
type AndroidConfig = {
  channelId: string;
  smallIcon: string;
  color: string;
  pressAction: { id: string };
  largeIcon?: string;
  style?:
    | { type: 'BIG_TEXT'; text: string }
    | { type: 'BIG_PICTURE'; picture: string };
};

export type SocialNotification = {
  title: string;
  body: string;
  data: Record<string, string>;
  android: AndroidConfig;
};

export type MuteFlags = {
  notif_social: boolean;
};

export type Recipient = { userId: string; type: SocialType };

const SOCIAL_CHANNEL = 'social';
const SOCIAL_TAP_TYPE = 'social';
const SMALL_ICON = 'notification_icon';
const BRAND = '#22d3ee';
const PREVIEW_MAX = 120;

const CATEGORY_LABEL: Record<string, string> = {
  feature: 'feature',
  optimization: 'optimization',
  fix: 'fix',
};

// @mentions in comments: usernames are \w{3,20}, capture all, case-preserved, deduped.
const MENTION_RE = /@(\w{3,20})/gu;

export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    if (match[1]) out.add(match[1]);
  }
  return [...out];
}

// only real remote URLs render as largeIcon/picture; presets & null fall back to app logo.
export function pushAvatarUrl(
  avatar: string | null | undefined
): string | undefined {
  return typeof avatar === 'string' && /^https?:\/\//u.test(avatar)
    ? avatar
    : undefined;
}

function handleOf(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

export function socialTitle(type: SocialType, actorName: string): string {
  const who = handleOf(actorName);
  switch (type) {
    case 'reply':
      return `${who} replied to your comment`;
    case 'mention':
      return `${who} mentioned you`;
    case 'like':
      return `${who} liked your comment`;
    case 'comment':
      return `${who} commented`;
  }
}

function stripMentions(text: string): string {
  return text
    .replace(MENTION_RE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

export function previewText(
  input: {
    body?: string | null;
    gifUrl?: string | null;
    imageUrl?: string | null;
  },
  max = PREVIEW_MAX
): string {
  const body = stripMentions((input.body ?? '').trim());
  if (body) return body.length > max ? `${body.slice(0, max - 1)}…` : body;
  if (input.gifUrl) return 'GIF';
  if (input.imageUrl) return '📷 Photo';
  return '';
}

// precedence: reply > mention > comment. actor never notifies self.
export function resolveCommentRecipients(input: {
  actorId: string;
  parentAuthorId: string | null;
  mentionedUserIds: string[];
  creatorIds: string[];
}): Recipient[] {
  const picked = new Map<string, SocialType>();
  const add = (userId: string, type: SocialType): void => {
    if (!userId || userId === input.actorId || picked.has(userId)) return;
    picked.set(userId, type);
  };
  if (input.parentAuthorId) add(input.parentAuthorId, 'reply');
  for (const userId of input.mentionedUserIds) add(userId, 'mention');
  for (const userId of input.creatorIds) add(userId, 'comment');
  return [...picked].map(([userId, type]) => ({ userId, type }));
}

export function resolveLikeRecipients(input: {
  actorId: string;
  commentAuthorId: string;
}): Recipient[] {
  if (!input.commentAuthorId || input.commentAuthorId === input.actorId) {
    return [];
  }
  return [{ userId: input.commentAuthorId, type: 'like' }];
}

export function isMuted(_type: SocialType, flags: MuteFlags): boolean {
  return !flags.notif_social;
}

export function collapseKeyFor(
  type: SocialType,
  commentId: string
): string | undefined {
  return type === 'like' ? `like:${commentId}` : undefined;
}

export function buildSocialNotification(event: {
  type: SocialType;
  actorName: string;
  actorAvatar?: string | null;
  preview: string;
  updateId: string;
  commentId: string;
}): SocialNotification {
  const largeIcon = pushAvatarUrl(event.actorAvatar);
  const android: AndroidConfig = {
    channelId: SOCIAL_CHANNEL,
    smallIcon: SMALL_ICON,
    color: BRAND,
    pressAction: { id: 'default' },
    ...(largeIcon ? { largeIcon } : {}),
    ...(event.preview
      ? { style: { type: 'BIG_TEXT', text: event.preview } }
      : {}),
  };
  return {
    title: socialTitle(event.type, event.actorName),
    body: event.preview,
    data: {
      type: SOCIAL_TAP_TYPE,
      kind: event.type,
      updateId: event.updateId,
      commentId: event.commentId,
      actorName: event.actorName,
      ...(event.actorAvatar ? { avatar: event.actorAvatar } : {}),
    },
    android,
  };
}

export function buildUpdateNotification(event: {
  category: string;
  title: string;
  creatorAvatar?: string | null;
  imageUrl?: string | null;
  updateId: string;
}): SocialNotification {
  const label = CATEGORY_LABEL[event.category] ?? 'update';
  const heading = `New ${label}: ${event.title}`;
  const largeIcon = pushAvatarUrl(event.creatorAvatar);
  const picture = pushAvatarUrl(event.imageUrl);
  const android: AndroidConfig = {
    channelId: SOCIAL_CHANNEL,
    smallIcon: SMALL_ICON,
    color: BRAND,
    pressAction: { id: 'default' },
    ...(largeIcon ? { largeIcon } : {}),
    style: picture
      ? { type: 'BIG_PICTURE', picture }
      : { type: 'BIG_TEXT', text: heading },
  };
  return {
    title: heading,
    body: 'Tap to see what’s new',
    data: {
      type: SOCIAL_TAP_TYPE,
      kind: 'update',
      updateId: event.updateId,
      ...(event.creatorAvatar ? { avatar: event.creatorAvatar } : {}),
    },
    android,
  };
}
