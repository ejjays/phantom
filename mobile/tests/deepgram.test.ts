import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native-blob-util', () => ({
  default: { fetch: vi.fn(), wrap: vi.fn((path: string) => path) },
}));

import { deepgramWords } from '../src/lib/deepgram';

const payload = {
  results: {
    channels: [
      {
        alternatives: [
          {
            words: [
              { word: 'hello', start: 1.0, end: 1.4 },
              { word: 'world', start: 1.5, end: 1.9 },
              { word: '', start: 2.0, end: 2.1 },
              { word: 'bad', start: 3.0, end: 2.0 },
            ],
          },
          { words: [{ word: 'late', start: 0.5, end: 0.9 }] },
        ],
      },
    ],
  },
};

describe('deepgramWords', () => {
  it('collects timed words across alternatives, sorted', () => {
    expect(deepgramWords(payload)).toEqual([
      { word: 'late', start: 0.5, end: 0.9 },
      { word: 'hello', start: 1.0, end: 1.4 },
      { word: 'world', start: 1.5, end: 1.9 },
    ]);
  });

  it('returns empty on junk', () => {
    expect(deepgramWords(null)).toEqual([]);
    expect(deepgramWords({})).toEqual([]);
    expect(deepgramWords({ results: {} })).toEqual([]);
  });
});
