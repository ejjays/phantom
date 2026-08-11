import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) =>
      store.has(`__fail__${k}`)
        ? Promise.reject(new Error('get failed'))
        : Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
  },
}));

import { nextSpeechMsgIndex, nextQuipIndex } from '../src/lib/settings';

const MSG_KEY = 'phantom.speech.msgIdx';
const QUIP_KEY = 'phantom.speech.quipIdx';

describe('speech message indices', () => {
  let random: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    random.mockRestore();
  });

  it('round-robins returning pairs without repeating before a full cycle', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      seen.push(await nextSpeechMsgIndex(7));
    }
    expect(new Set(seen).size).toBe(7);
    expect(await nextSpeechMsgIndex(7)).toBe(seen[0]);
  });

  it('persists the next index for the following greeting', async () => {
    const index = await nextSpeechMsgIndex(7);
    expect(store.get(MSG_KEY)).toBe(String((index + 1) % 7));
  });

  it('falls back to random on corrupt stored index', async () => {
    store.set(MSG_KEY, 'not-a-number');
    const index = await nextSpeechMsgIndex(7);
    expect(Number.isInteger(index) && index >= 0 && index < 7).toBe(true);
    expect(store.get(MSG_KEY)).toBe(String((index + 1) % 7));
  });

  it('falls back to random when storage read fails', async () => {
    store.set(`__fail__${MSG_KEY}`, '1');
    const index = await nextSpeechMsgIndex(7);
    expect(Number.isInteger(index) && index >= 0 && index < 7).toBe(true);
  });

  it('never repeats the previously shown quip', async () => {
    store.set(QUIP_KEY, '2');
    let prev = -1;
    for (let i = 0; i < 12; i += 1) {
      const next = await nextQuipIndex(5);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});
