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
  restoreHistory,
  clearHistory,
  dedupeByUri,
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
  beforeEach(async () => {
    store.clear();
    await clearHistory();
  });

  it('stores and lists newest-first', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
    const parsed = JSON.parse(raw ?? '[]') as unknown[];
    expect(parsed.map((x) => (x as { id: string }).id)).toEqual(['b', 'a']);
  });

  it('dedupes by id (keeps newest position)', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    await addHistory(item('a'));
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
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
    ).default.getItem('phantom.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed.map((x) => x.id)).toEqual(['b']);
  });

  it('clearHistory empties the list', async () => {
    await addHistory(item('a'));
    await clearHistory();
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
    expect(raw).toBeNull();
  });

  it('restoreHistory reinserts at the original index', async () => {
    await addHistory(item('c'));
    await addHistory(item('b'));
    await addHistory(item('a'));
    await removeHistory('b');
    const restored = item('b');
    await restoreHistory(restored, 1);
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('restoreHistory clamps out-of-range indices', async () => {
    await addHistory(item('b'));
    await addHistory(item('a'));
    await removeHistory('b');
    await restoreHistory(item('b'), 99);
    await removeHistory('b');
    await restoreHistory(item('b'), -5);
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('restoreHistory dedupes when id already present', async () => {
    await addHistory(item('a'));
    await addHistory(item('b'));
    await restoreHistory(item('b'), 0);
    const raw = await (
      await import('@react-native-async-storage/async-storage')
    ).default.getItem('phantom.download.history');
    const parsed = JSON.parse(raw ?? '[]') as { id: string }[];
    expect(parsed.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('dedupeByUri drops entries sharing the same saved file', () => {
    const first = { ...item('a'), uri: 'file:///same.mp4' };
    const dup = { ...item('b'), uri: 'file:///same.mp4' };
    const other = { ...item('c'), uri: 'file:///other.mp4' };
    const bare = { ...item('d') };
    expect(dedupeByUri([first, dup, other, bare]).map((x) => x.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });
});
