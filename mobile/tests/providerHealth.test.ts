import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});

async function load() {
  return await import('../src/lib/providerHealth');
}

describe('local failure memory', () => {
  it('marks down and clears on success', async () => {
    const { markLegDown, markLegUp, localDown } = await load();
    expect(localDown().size).toBe(0);
    markLegDown('vidlove');
    expect([...localDown()]).toEqual(['vidlove']);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
    markLegUp('vidlove');
    expect(localDown().size).toBe(0);
  });

  it('expires marks after the cooldown', async () => {
    const { markLegDown, localDown, LOCAL_DOWN_COOLDOWN_MS } = await load();
    markLegDown('vidzee');
    const at = Date.now();
    expect(localDown(at).has('vidzee')).toBe(true);
    expect(localDown(at + LOCAL_DOWN_COOLDOWN_MS + 1000).has('vidzee')).toBe(false);
    expect(localDown(at + LOCAL_DOWN_COOLDOWN_MS + 1000).size).toBe(0);
  });

  it('hydrates persisted marks', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify({ vidrock: Date.now() })
    );
    const { localDown } = await load();
    await new Promise((done) => setTimeout(done, 10));
    expect(localDown().has('vidrock')).toBe(true);
  });

  it('ignores malformed persisted marks', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{"vidrock":"soon"}');
    const { localDown } = await load();
    await new Promise((done) => setTimeout(done, 10));
    expect(localDown().size).toBe(0);
  });
});

describe('legOfFormatId', () => {
  it('maps prefixes to legs', async () => {
    const { legOfFormatId } = await load();
    expect(legOfFormatId('vidrock-luna-auto')).toBe('vidrock');
    expect(legOfFormatId('vidlove-vidapi-auto')).toBe('vidlove');
    expect(legOfFormatId('vixsrc-720p')).toBe('vixsrc');
    expect(legOfFormatId('vidzee-dcloud-auto')).toBe('vidzee');
    expect(legOfFormatId('paradise-auto')).toBe('paradise');
    expect(legOfFormatId('something-else')).toBeNull();
    expect(legOfFormatId(null)).toBeNull();
  });
});

describe('isTransportDown', () => {
  it('treats 4xx as unknown, everything else as down', async () => {
    const { isTransportDown } = await load();
    expect(isTransportDown(new Error('vidlove 403'))).toBe(false);
    expect(isTransportDown(new Error('vixsrc 404'))).toBe(false);
    expect(isTransportDown(new Error('vidrock 500'))).toBe(true);
    expect(isTransportDown(new Error('vidzee 502'))).toBe(true);
    expect(isTransportDown(new Error('timeout'))).toBe(true);
    expect(isTransportDown(new Error('socket hang up'))).toBe(true);
  });
});
