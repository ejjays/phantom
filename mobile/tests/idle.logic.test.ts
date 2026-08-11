import { describe, it, expect } from 'vitest';
import {
  idleTick,
  IDLE_MS,
  IDLE_BUFFER_MS,
  IDLE_REPEAT_MS,
} from '../src/lib/idle.logic';

const quiet = {
  now: 100_000,
  lastActivity: 1,
  lastIdleAt: 1,
  lastIdleStart: 1,
  bubbleUp: false,
};

describe('idleTick', () => {
  it('fires when the clock is quiet and no bubble is up', () => {
    expect(idleTick(quiet)).toBe('fire');
  });
  it('pauses while any bubble is up, even with a stale clock', () => {
    expect(idleTick({ ...quiet, bubbleUp: true })).toBe('pause');
  });
  it.each([
    ['activity', IDLE_MS, 'lastActivity'],
    ['post-idle buffer', IDLE_BUFFER_MS, 'lastIdleAt'],
    ['repeat window', IDLE_REPEAT_MS, 'lastIdleStart'],
  ] as const)('waits inside the %s gate', (_label, gate, key) => {
    expect(idleTick({ ...quiet, [key]: 100_000 - gate + 1 })).toBe('wait');
  });
  it.each([
    ['activity', IDLE_MS, 'lastActivity'],
    ['repeat window', IDLE_REPEAT_MS, 'lastIdleStart'],
  ] as const)('fires exactly at the %s threshold', (_label, gate, key) => {
    expect(idleTick({ ...quiet, [key]: 100_000 - gate })).toBe('fire');
  });
});
