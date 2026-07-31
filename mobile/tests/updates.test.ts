import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  validateComment,
  suggestUsernameFrom,
  summarizeReactions,
  planReactionToggle,
  relativeTime,
  generateGuestName,
  isGuestName,
  displayName,
  REACTION_EMOJIS,
  type ReactionRow,
} from '../src/lib/social/updates.logic';

describe('guest name helpers', () => {
  it('generates word-safe handles of 3-20 chars', () => {
    const name = generateGuestName();
    expect(name).toMatch(/^anonymous\d{5}$/u);
    expect(name.length).toBeGreaterThanOrEqual(3);
    expect(name.length).toBeLessThanOrEqual(20);
  });

  it('generates distinct names across calls', () => {
    const seen = new Set(
      Array.from({ length: 100 }, () => generateGuestName())
    );
    expect(seen.size).toBe(100);
  });

  it.each([
    ['anonymous30584', true],
    ['anonymous99999', true],
    ['anonymous1234', false],
    ['anonymous123456', false],
    ['bob', false],
    [null, false],
    [undefined, false],
  ])('isGuestName(%s) -> %s', (input, expected) => {
    expect(isGuestName(input)).toBe(expected);
  });

  it('prettifies guest handles for display', () => {
    expect(displayName('anonymous30584')).toBe('Anonymous 30584');
  });

  it('leaves regular handles untouched', () => {
    expect(displayName('alice')).toBe('alice');
    expect(displayName(null)).toBe('Guest');
  });
});

describe('validateUsername', () => {
  it.each([
    ['ab', false],
    ['abc', true],
    ['a'.repeat(20), true],
    ['a'.repeat(21), false],
    ['has space', false],
    ['bad!', false],
    ['good_name_1', true],
  ])('validates %s -> ok=%s', (input, ok) => {
    expect(validateUsername(input).ok).toBe(ok);
  });

  it('trims and returns the cleaned value', () => {
    const out = validateUsername('  xb_dev  ');
    expect(out).toEqual({ ok: true, value: 'xb_dev' });
  });
});

describe('suggestUsernameFrom', () => {
  it.each([
    [null, ''],
    ['', ''],
    ['John Smith', 'john_smith'],
    ['  Mary  Jane  ', 'mary_jane'],
    ['a', ''],
    ['Bob!!!', 'bob'],
  ])('suggests from %s -> %s', (input, expected) => {
    expect(suggestUsernameFrom(input)).toBe(expected);
  });

  it('caps the suggestion at the max length', () => {
    expect(suggestUsernameFrom('x'.repeat(40)).length).toBe(20);
  });
});

describe('validateComment', () => {
  it('rejects empty or whitespace-only', () => {
    expect(validateComment('').ok).toBe(false);
    expect(validateComment('   ').ok).toBe(false);
  });

  it('rejects over the max length', () => {
    expect(validateComment('x'.repeat(501)).ok).toBe(false);
  });

  it('trims a valid comment', () => {
    expect(validateComment('  hi  ')).toEqual({ ok: true, value: 'hi' });
  });
});

const rows: ReactionRow[] = [
  { updateId: 'u1', emoji: '🔥', userId: 'me' },
  { updateId: 'u1', emoji: '🔥', userId: 'other' },
  { updateId: 'u1', emoji: '❤️', userId: 'other' },
  { updateId: 'u2', emoji: '🔥', userId: 'me' },
];

describe('summarizeReactions', () => {
  it('counts per emoji scoped to one update', () => {
    const tally = summarizeReactions(rows, 'u1', 'me');
    const fire = tally.find((entry) => entry.emoji === '🔥');
    const heart = tally.find((entry) => entry.emoji === '❤️');
    expect(fire?.count).toBe(2);
    expect(heart?.count).toBe(1);
  });

  it('marks mine only for the current user reactions', () => {
    const tally = summarizeReactions(rows, 'u1', 'me');
    expect(tally.find((entry) => entry.emoji === '🔥')?.mine).toBe(true);
    expect(tally.find((entry) => entry.emoji === '❤️')?.mine).toBe(false);
  });

  it('never marks mine when there is no user', () => {
    const tally = summarizeReactions(rows, 'u1', null);
    expect(tally.every((entry) => entry.mine === false)).toBe(true);
  });

  it('returns one entry per known emoji', () => {
    expect(summarizeReactions([], 'u1', null)).toHaveLength(
      REACTION_EMOJIS.length
    );
  });
});

describe('planReactionToggle', () => {
  it('inserts when the user has not reacted', () => {
    expect(planReactionToggle(rows, 'u1', '🎉', 'me')).toBe('insert');
  });

  it('deletes when the same reaction already exists', () => {
    expect(planReactionToggle(rows, 'u1', '🔥', 'me')).toBe('delete');
  });

  it('ignores other users when planning', () => {
    expect(planReactionToggle(rows, 'u1', '❤️', 'me')).toBe('insert');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-06-21T12:00:00Z');

  it.each([
    ['2026-06-21T11:59:30Z', 'just now'],
    ['2026-06-21T11:30:00Z', '30m ago'],
    ['2026-06-21T09:00:00Z', '3h ago'],
    ['2026-06-19T12:00:00Z', '2d ago'],
    ['2026-06-07T12:00:00Z', '2w ago'],
  ])('formats %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('returns empty string for an invalid date', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
  });

  it.each([
    ['2026-06-21T11:59:59Z', '1s ago'],
    ['2026-06-21T11:59:30Z', '30s ago'],
    ['2026-06-21T11:30:00Z', '30m ago'],
  ])('with seconds, formats %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now, true)).toBe(expected);
  });

  it('with seconds, still says just now at zero', () => {
    expect(relativeTime('2026-06-21T12:00:00Z', now, true)).toBe('just now');
  });
});
