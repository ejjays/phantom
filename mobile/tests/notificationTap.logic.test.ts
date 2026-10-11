import { describe, it, expect } from 'vitest';
import { parseSocialTap } from '../src/lib/push/notificationTap.logic';

describe('parseSocialTap', () => {
  it('maps a comment tap to updateId + commentId', () => {
    expect(
      parseSocialTap({
        type: 'social',
        kind: 'reply',
        updateId: 'u1',
        commentId: 'c1',
      })
    ).toEqual({ updateId: 'u1', commentId: 'c1' });
  });

  it('maps an update tap with no commentId', () => {
    expect(
      parseSocialTap({ type: 'social', kind: 'update', updateId: 'u9' })
    ).toEqual({ updateId: 'u9', commentId: null });
  });

  it('ignores non-social taps', () => {
    expect(
      parseSocialTap({ type: 'download-complete', updateId: 'u1' })
    ).toBeNull();
  });

  it.each([undefined, null, {}, { type: 'social' }])(
    'returns null for %s',
    (data) => {
      expect(parseSocialTap(data as Record<string, unknown> | null)).toBeNull();
    }
  );
});
