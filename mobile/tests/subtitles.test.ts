import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import {
  alignCuesToSpeech,
  cueAt,
  fetchVttText,
  fitCuesToDuration,
  formatVtt,
  langOfLabel,
  parseVtt,
  pickTrack,
  speechOfSilence,
  speechOfWords,
  wordsToCues,
  type SpeechSeg,
  type SubtitleCue,
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

  it('strips ass overrides and newlines', () => {
    const cues = parseVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n{\\an8}Top line\\Nsecond line\n'
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toBe('Top line\nsecond line');
  });
});

describe('alignCuesToSpeech', () => {
  const speech: SpeechSeg[] = [
    { start: 100, end: 140 },
    { start: 200, end: 260 },
    { start: 320, end: 360 },
    { start: 420, end: 470 },
    { start: 530, end: 580 },
    { start: 640, end: 690 },
    { start: 750, end: 800 },
    { start: 860, end: 910 },
  ];
  const cue = (start: number, end: number): SubtitleCue => ({
    start,
    end,
    text: 'x',
  });

  it('finds a constant shift', () => {
    const cues = [
      cue(92, 94),
      cue(110, 112),
      cue(220, 224),
      cue(330, 334),
      cue(540, 544),
      cue(760, 764),
    ];
    const found = alignCuesToSpeech(cues, speech, 1000);
    expect(found?.offset).toBe(8);
    expect(found ? found.confidence > 0.6 : false).toBe(true);
  });

  it('reports zero when already synced', () => {
    const cues = [
      cue(100, 104),
      cue(220, 224),
      cue(430, 434),
      cue(650, 654),
      cue(870, 874),
    ];
    const found = alignCuesToSpeech(cues, speech, 1000);
    expect(found?.offset).toBe(0);
  });

  it('returns null with no signal', () => {
    expect(alignCuesToSpeech([], speech, 300)).toBeNull();
    expect(alignCuesToSpeech([cue(100, 104)], [], 300)).toBeNull();
    expect(
      alignCuesToSpeech([cue(100, 104)], [{ start: 10, end: 14 }], 300)
    ).toBeNull();
  });
});

describe('speechOfWords', () => {
  it('merges near words and drops junk', () => {
    expect(
      speechOfWords([
        { start: 1.0, end: 1.4 },
        { start: 1.5, end: 1.9 },
        { start: 10.0, end: 10.5 },
        { start: 5.0, end: 4.0 },
      ])
    ).toEqual([
      { start: 1.0, end: 1.9 },
      { start: 10.0, end: 10.5 },
    ]);
  });
});
describe('wordsToCues', () => {
  const word = (text: string, start: number, end: number) => ({
    word: text,
    start,
    end,
  });
  it('breaks on pauses and length', () => {
    expect(
      wordsToCues([
        word('hello', 1.0, 1.4),
        word('there', 1.5, 1.9),
        word('later', 5.0, 5.4),
      ])
    ).toEqual([
      { start: 1.0, end: 1.9, text: 'hello there' },
      { start: 5.0, end: 5.4, text: 'later' },
    ]);
    expect(wordsToCues([])).toEqual([]);
    expect(wordsToCues([word('  ', 1.0, 1.4), word('bad', 2.0, 1.0)])).toEqual(
      []
    );
  });
});

describe('speechOfSilence', () => {
  it('inverts closed silences into speech', () => {
    const segs = speechOfSilence(
      '[silencedetect] silence_start: 10\n[silencedetect] silence_end: 20 | silence_duration: 10\n' +
        '[silencedetect] silence_start: 50\n[silencedetect] silence_end: 60 | silence_duration: 10\n',
      100
    );
    expect(segs).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 100 },
    ]);
  });

  it('ignores dangling starts and tiny slivers', () => {
    const segs = speechOfSilence('[silencedetect] silence_start: 90\n', 100);
    expect(segs).toEqual([{ start: 0, end: 100 }]);
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
    await expect(fetchVttText('https://x/en.vtt', {})).resolves.toContain(
      'WEBVTT'
    );
  });
});
