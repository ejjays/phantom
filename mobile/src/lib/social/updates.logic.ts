export type UpdateCategory = 'feature' | 'optimization' | 'fix';

export type Update = {
  id: string;
  version: string | null;
  title: string;
  body: string;
  category: UpdateCategory;
  publishedAt: string;
  imageUrl: string | null;
};

export type ReactionRow = {
  updateId: string;
  emoji: string;
  userId: string;
};

export type ReactionTally = {
  emoji: string;
  count: number;
  mine: boolean;
};

export type UpdateComment = {
  id: string;
  updateId: string;
  body: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  mine: boolean;
  parentId: string | null;
  likeCount: number;
  liked: boolean;
  gifUrl: string | null;
  imageUrl: string | null;
  creator: boolean;
};

export type Validation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export const REACTION_EMOJIS = ['🔥', '❤️', '🎉', '👍'] as const;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const COMMENT_MAX = 500;

const USERNAME_PATTERN = /^\w+$/u;

export function validateUsername(raw: string): Validation {
  const value = raw.trim();
  if (value.length < USERNAME_MIN) {
    return { ok: false, error: `at least ${USERNAME_MIN} characters` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, error: `at most ${USERNAME_MAX} characters` };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { ok: false, error: 'letters, numbers, underscore only' };
  }
  return { ok: true, value };
}

export function suggestUsernameFrom(name: string | null): string {
  if (!name) return '';
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, USERNAME_MAX);
  return base.length >= USERNAME_MIN ? base : '';
}

// guests get an auto handle `anonymous` + 5 digits: unique, \w-safe for
// mentions, and prettifiable to "Anonymous 30584" for display only.
const GUEST_PATTERN = /^anonymous\d{5}$/u;

export function generateGuestName(): string {
  return `anonymous${Math.floor(10000 + Math.random() * 90000)}`;
}

export function isGuestName(
  username: string | null | undefined
): username is string {
  return typeof username === 'string' && GUEST_PATTERN.test(username);
}

export function displayName(username: string | null | undefined): string {
  if (isGuestName(username)) {
    return `Anonymous ${username.slice('anonymous'.length)}`;
  }
  return username ?? 'Guest';
}

export function validateComment(
  raw: string,
  hasAttachment = false
): Validation {
  const value = raw.trim();
  if (value.length === 0) {
    // gif-only comments are allowed when an attachment is present
    return hasAttachment
      ? { ok: true, value }
      : { ok: false, error: 'comment is empty' };
  }
  if (value.length > COMMENT_MAX) {
    return { ok: false, error: `at most ${COMMENT_MAX} characters` };
  }
  return { ok: true, value };
}

export function summarizeReactions(
  rows: ReactionRow[],
  updateId: string,
  userId: string | null
): ReactionTally[] {
  return REACTION_EMOJIS.map((emoji) => {
    const matches = rows.filter(
      (row) => row.updateId === updateId && row.emoji === emoji
    );
    return {
      emoji,
      count: matches.length,
      mine: userId !== null && matches.some((row) => row.userId === userId),
    };
  });
}

export function planReactionToggle(
  rows: ReactionRow[],
  updateId: string,
  emoji: string,
  userId: string
): 'insert' | 'delete' {
  const exists = rows.some(
    (row) =>
      row.updateId === updateId && row.emoji === emoji && row.userId === userId
  );
  return exists ? 'delete' : 'insert';
}

export function relativeTime(
  iso: string,
  now = Date.now(),
  withSeconds = false
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return withSeconds && secs >= 1 ? `${secs}s ago` : 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
