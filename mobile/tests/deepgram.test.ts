import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native-blob-util', () => ({
  default: { fetch: vi.fn(), wrap: vi.fn((path: string) => path) },
}));

import { deepgramWords, deepgramUtterances, deepgramLang, deepgramConfidence } from '../src/lib/deepgram';

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

  it('enforces monotonic start timestamps for overlapping words', () => {
    const input = {
      results: {
        channels: [
          {
            alternatives: [
              {
                words: [
                  { word: 'first', start: 2.0, end: 2.5 },
                  { word: 'second', start: 1.8, end: 2.2 },
                ],
              },
            ],
          },
        ],
      },
    };
    const words = deepgramWords(input);
    expect(words[0].word).toBe('second');
    expect(words[1].word).toBe('first');
    expect(words[1].start).toBeGreaterThanOrEqual(words[0].start);
    expect(words[1].end).toBeGreaterThan(words[1].start);
  });

  it('returns empty on junk', () => {
    expect(deepgramWords(null)).toEqual([]);
    expect(deepgramWords({})).toEqual([]);
    expect(deepgramWords({ results: {} })).toEqual([]);
  });
});

describe('deepgramUtterances', () => {
  const shaped = (utterances: unknown) => ({ results: { utterances } });
  it('maps utterances to cues with speakers, sorted', () => {
    expect(
      deepgramUtterances(
        shaped([
          { start: 5.0, end: 7.2, transcript: 'Second line.', speaker: 1 },
          { start: 1.0, end: 2.4, transcript: 'First line.', speaker: 0 },
          { start: 9.0, end: 8.0, transcript: 'Backwards.', speaker: 0 },
          { start: 10.0, end: 11.0, transcript: '   ', speaker: 0 },
          { start: 12.0, end: 13.0, transcript: 'No speaker.' },
        ])
      )
    ).toEqual([
      { start: 1.0, end: 2.4, text: 'First line.', speaker: 0 },
      { start: 5.0, end: 7.2, text: 'Second line.', speaker: 1 },
      { start: 12.0, end: 13.0, text: 'No speaker.', speaker: -1 },
    ]);
  });

  it('returns empty on junk', () => {
    expect(deepgramUtterances(null)).toEqual([]);
    expect(deepgramUtterances({})).toEqual([]);
    expect(deepgramUtterances({ results: {} })).toEqual([]);
    expect(deepgramUtterances({ utterances: [] })).toEqual([]);
  });
});

describe('deepgramConfidence', () => {
  const shaped = (words: unknown) => ({
    results: { channels: [{ alternatives: [{ words }] }] },
  });
  it('averages word confidence', () => {
    expect(
      deepgramConfidence(
        shaped([
          { word: 'a', start: 1, end: 2, confidence: 0.5 },
          { word: 'b', start: 2, end: 3, confidence: 0.9 },
          { word: 'c', start: 3, end: 4 },
        ])
      )
    ).toBeCloseTo(0.7, 5);
    expect(deepgramConfidence(null)).toBe(-1);
    expect(deepgramConfidence({})).toBe(-1);
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
