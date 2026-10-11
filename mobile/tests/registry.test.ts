import { describe, it, expect } from 'vitest';
import { parseMappingRow } from '../src/extractors/spotify/registry';

const cell = (value: string | null) => ({
  type: value === null ? 'null' : 'text',
  value,
});

describe('parseMappingRow', () => {
  it('parses a full row in SELECT order', () => {
    const row = [
      cell('Never Gonna Give You Up'),
      cell('Rick Astley'),
      cell('https://img/cover.jpg'),
      cell('213'),
      cell('GBARL9300135'),
      cell('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ];
    expect(parseMappingRow(row)).toEqual({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      cover: 'https://img/cover.jpg',
      durationMs: 213000,
      isrc: 'GBARL9300135',
    });
  });

  it('treats null cover and isrc as undefined', () => {
    const row = [
      cell('Track'),
      cell('Artist'),
      cell(null),
      cell('100'),
      cell(null),
      cell('https://youtu.be/abc'),
    ];
    const out = parseMappingRow(row);
    expect(out?.cover).toBeUndefined();
    expect(out?.isrc).toBeUndefined();
    expect(out?.durationMs).toBe(100000);
  });

  it('returns null for an undefined row', () => {
    expect(parseMappingRow(undefined)).toBeNull();
  });

  it('returns null for a short row', () => {
    expect(parseMappingRow([cell('t'), cell('a')])).toBeNull();
  });

  it('returns null when youtubeUrl is not http(s)', () => {
    const row = [
      cell('t'),
      cell('a'),
      cell(null),
      cell('1'),
      cell(null),
      cell(''),
    ];
    expect(parseMappingRow(row)).toBeNull();
  });

  it('returns null when title or artist is missing', () => {
    const row = [
      cell(''),
      cell('a'),
      cell(null),
      cell('1'),
      cell(null),
      cell('https://youtu.be/x'),
    ];
    expect(parseMappingRow(row)).toBeNull();
  });
});
