import { describe, it, expect } from 'vitest';
import {
  TOPIC_UPDATES,
  deviceTokenRow,
  shouldRegisterToken,
} from '../src/lib/push/push.logic';

describe('deviceTokenRow', () => {
  it('builds a row with android platform and an ISO timestamp', () => {
    const at = Date.parse('2026-07-08T12:00:00Z');
    expect(deviceTokenRow('user-1', 'tok-abc', at)).toEqual({
      user_id: 'user-1',
      token: 'tok-abc',
      platform: 'android',
      updated_at: '2026-07-08T12:00:00.000Z',
    });
  });
});

describe('shouldRegisterToken', () => {
  it.each([
    [true, 'user-1', true],
    [true, null, false],
    [true, '', false],
    [false, 'user-1', false],
    [false, null, false],
  ])('configured=%s userId=%s -> %s', (configured, userId, expected) => {
    expect(shouldRegisterToken(configured, userId)).toBe(expected);
  });
});

describe('TOPIC_UPDATES', () => {
  it('is the shared broadcast topic name', () => {
    expect(TOPIC_UPDATES).toBe('updates');
  });
});
