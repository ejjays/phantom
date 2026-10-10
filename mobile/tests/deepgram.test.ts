import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native-blob-util', () => ({
  default: { fetch: vi.fn(), wrap: vi.fn((path: string) => path) },
}));

import { deepgramWords, deepgramUtterances, deepgramLang } from '../src/lib/deepgram';

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

describe('deepgramUtterances', () => {
  const shaped = (utterances: unknown) => ({ results: { utterances } });
  it('maps utterances to cues, sorted', () => {
    expect(
      deepgramUtterances(
        shaped([
          { start: 5.0, end: 7.2, transcript: 'Second line.' },
          { start: 1.0, end: 2.4, transcript: 'First line.' },
          { start: 9.0, end: 8.0, transcript: 'Backwards.' },
          { start: 10.0, end: 11.0, transcript: '   ' },
        ])
      )
    ).toEqual([
      { start: 1.0, end: 2.4, text: 'First line.' },
      { start: 5.0, end: 7.2, text: 'Second line.' },
    ]);
  });

  it('returns empty on junk', () => {
    expect(deepgramUtterances(null)).toEqual([]);
    expect(deepgramUtterances({})).toEqual([]);
    expect(deepgramUtterances({ results: {} })).toEqual([]);
    expect(deepgramUtterances({ utterances: [] })).toEqual([]);
  });
});

describe('deepgramLang', () => {
  it('reads the detected language code', () => {
    const shaped = (languages: unknown) => ({
      results: { channels: [{ alternatives: [{ languages }] }] },
    });
    expect(deepgramLang(shaped(['en']))).toBe('en');
    expect(deepgramLang(shaped(['ko']))).toBe('ko');
    expect(deepgramLang(shaped([]))).toBe('');
    expect(deepgramLang(null)).toBe('');
    expect(deepgramLang({})).toBe('');
  });
});
