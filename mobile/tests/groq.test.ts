import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native-blob-util', () => ({
  default: {
    fetch: vi.fn(),
    wrap: vi.fn((path: string) => path),
    fs: { unlink: vi.fn() },
  },
}));

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

import {
  groqWords,
  groqSegments,
  base64ToBytes,
  bytesToBase64,
  buildMultipartBody,
} from '../src/lib/groq';

describe('groqWords', () => {
  it('collects whisper words, sorted', () => {
    expect(
      groqWords({
        text: 'hello world',
        words: [
          { word: 'hello', start: 1.0, end: 1.4 },
          { word: 'world', start: 1.5, end: 1.9 },
          { word: '', start: 2.0, end: 2.1 },
          { word: 'bad', start: 3.0, end: 2.0 },
        ],
      })
    ).toEqual([
      { word: 'hello', start: 1.0, end: 1.4 },
      { word: 'world', start: 1.5, end: 1.9 },
    ]);
  });

  it('falls back to segments when words are absent', () => {
    expect(
      groqWords({
        text: 'hi there',
        segments: [{ text: 'hi there', start: 0.5, end: 1.9 }],
      })
    ).toEqual([{ word: 'hi there', start: 0.5, end: 1.9 }]);
  });

  it('returns empty on junk', () => {
    expect(groqWords(null)).toEqual([]);
    expect(groqWords({})).toEqual([]);
    expect(groqWords({ text: 'x' })).toEqual([]);
  });
});

describe('groqSegments', () => {
  it('maps segments to cues and collapses repeats', () => {
    expect(
      groqSegments({
        segments: [
          { start: 1.0, end: 2.0, text: ' First.' },
          { start: 2.0, end: 3.0, text: 'First.' },
          { start: 3.0, end: 4.0, text: ' First. ' },
          { start: 5.0, end: 6.0, text: 'Second.' },
          { start: 7.0, end: 6.0, text: 'Backwards.' },
        ],
      })
    ).toEqual([
      { start: 1.0, end: 2.0, text: 'First.' },
      { start: 5.0, end: 6.0, text: 'Second.' },
    ]);
  });

  it('returns empty on junk', () => {
    expect(groqSegments(null)).toEqual([]);
    expect(groqSegments({})).toEqual([]);
    expect(groqSegments({ segments: 'x' })).toEqual([]);
  });
});

describe('multipart helpers', () => {
  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('!!!')).toEqual(new Uint8Array(0));
  });

  it('builds a parseable body', () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4]);
    const body = buildMultipartBody(
      'bnd',
      { model: 'm' },
      's.mp3',
      'audio/mpeg',
      fileBytes
    );
    const text = new TextDecoder('latin1').decode(body);
    expect(text).toContain('name="model"');
    expect(text).toContain('filename="s.mp3"');
    expect(body.slice(-11)).toEqual(
      new TextEncoder().encode('\r\n--bnd--\r\n')
    );
    expect(body.length).toBeGreaterThan(fileBytes.length + 100);
  });
});
