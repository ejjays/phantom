import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import {
  cueAt,
  fetchVttText,
  fitCuesToDuration,
  formatVtt,
  langOfLabel,
  parseVtt,
  pickTrack,
  type SubtitleTrack,
} from '../src/lib/subtitles';

const mockFetch = vi.mocked(gatedFetch);

const VTT = [
  'WEBVTT',
  '',
  '1',
  '00:00:01.000 --> 00:00:03.000',
  'First line',
  '',
  '00:00:10.500 --> 00:00:12.250',
  '<v Speaker>Second line</v>',
  '',
  'NOTE ignored block',
  '',
  '00:00:20.000 --> 00:00:21.000',
  '',
].join('\n');

describe('parseVtt', () => {
  it('reads cues and strips markup', () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 3, text: 'First line' });
    expect(cues[1]?.text).toBe('Second line');
  });

  it('drops empty and note blocks', () => {
    expect(parseVtt('WEBVTT\n\nNOTE hi\n')).toHaveLength(0);
    expect(parseVtt('')).toHaveLength(0);
  });
});

describe('formatVtt', () => {
  it('round-trips through parse', () => {
    const cues = parseVtt(VTT);
    expect(parseVtt(formatVtt(cues))).toEqual(cues);
  });
});

describe('fitCuesToDuration', () => {
  const cues = [
    { start: 0, end: 10, text: 'a' },
    { start: 90, end: 100, text: 'b' },
  ];

  it('leaves close matches alone', () => {
    expect(fitCuesToDuration(cues, 101)).toEqual(cues);
  });

  it('stretches a short track onto the video', () => {
    const fitted = fitCuesToDuration(cues, 110);
    expect(fitted[1]?.end).toBeCloseTo(110, 3);
    expect(fitted[1]?.start).toBeCloseTo(99, 3);
  });

  it('caps wild rescale', () => {
    const fitted = fitCuesToDuration(cues, 1000);
    expect(fitted[1]?.end).toBeLessThanOrEqual(118);
  });

  it('never passes the video end', () => {
    const fitted = fitCuesToDuration(cues, 50);
    expect(fitted.every((cue) => cue.end <= 50)).toBe(true);
  });
});

describe('cueAt', () => {
  const cues = [
    { start: 0, end: 4, text: 'one' },
    { start: 6, end: 9, text: 'two' },
  ];

  it.each([
    [0, 'one'],
    [3.9, 'one'],
    [6, 'two'],
    [8.9, 'two'],
  ])('%ss shows %s', (time, expected) => {
    expect(cueAt(cues, time)).toBe(expected);
  });

  it('returns null in gaps and past the end', () => {
    expect(cueAt(cues, 5)).toBeNull();
    expect(cueAt(cues, 99)).toBeNull();
  });
});

describe('langOfLabel', () => {
  it.each([
    ['English', 'en'],
    ['English - English', 'en'],
    ['Brazilian3', 'pt'],
    ['Portuguese (BR)2', 'pt'],
    ['Latin American Spanish', 'es'],
    ['Turkish', 'tr'],
    ['Unknown', 'und'],
  ])('%s -> %s', (label, expected) => {
    expect(langOfLabel(label)).toBe(expected);
  });
});

describe('pickTrack', () => {
  const tracks: SubtitleTrack[] = [
    { label: 'Arabic', lang: 'ar', url: 'a' },
    { label: 'English', lang: 'en', url: 'e' },
  ];

  it('prefers the requested language', () => {
    expect(pickTrack(tracks, 'en')?.url).toBe('e');
    expect(pickTrack(tracks, 'AR')?.url).toBe('a');
  });

  it('returns null when nothing matches', () => {
    expect(pickTrack(tracks, 'ja')).toBeNull();
    expect(pickTrack([], 'en')).toBeNull();
  });
});

describe('fetchVttText', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns null for non-subtitle payloads', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>nope</html>'),
    } as unknown as Response);
    await expect(fetchVttText('https://x/en.vtt', {})).resolves.toBeNull();
  });

  it('returns subtitle text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(VTT),
    } as unknown as Response);
    await expect(fetchVttText('https://x/en.vtt', {})).resolves.toContain('WEBVTT');
  });
});