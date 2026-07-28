import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  },
}));

import {
  addHistory,
  removeHistory,
  clearHistory,
} from '../src/lib/downloadHistory';

const item = (id: string) => ({
  id,
  title: `t-${id}`,
  platform: 'youtube',
  ext: 'mp4',
  isAudio: false,
  savedAt: 1,
});

describe('downloadHistory', () => {
  beforeEach(() => store.clear());

  it('stores and lists newest-first', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('nexstream.download.history');
    const parsed = JSON.parse(raw ?? '[]') as unknown[];
    expect(parsed.map((x) => (x as { id: string }).id)).toEqual(['b', 'a']);
  });

  it('dedupes by id (keeps newest position)', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    await addHistory(item('a'));
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('nexstream.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('a');
  });

  it('removeHistory drops only the matching id', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    await removeHistory('a');
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('nexstream.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed.map((x) => x.id)).toEqual(['b']);
  });

  it('clearHistory empties the list', async () => {
    await addHistory(item('a'));
    await clearHistory();
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('nexstream.download.history');
    expect(raw).toBeNull();
  });
});
