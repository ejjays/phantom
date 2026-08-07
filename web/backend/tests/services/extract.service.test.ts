import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSongData } from '../../src/services/extract.service.js';
import * as securityUtil from '../../src/utils/network/security.util.js'; // skipcq: JS-C1003
import * as ugService from '../../src/services/ug-grounding.service.js'; // skipcq: JS-C1003

// mock fpcalc
vi.mock('fpcalc', () => ({
  default: vi.fn((file, cb) => {
    cb(null, { fingerprint: 'mock_fingerprint', duration: 120 });
  }),
}));

// mock shazam
vi.mock('node-shazam', () => {
  return {
    Shazam: vi.fn().mockImplementation(function () {
      return {
        recognise: vi.fn().mockResolvedValue({
          track: {
            subtitle: 'Shazam Artist',
            title: 'Shazam Title',
            isrc: 'SHAZAM123',
          },
        }),
      };
    }),
  };
});

// mock gemini
const mockGenerateContent = vi.fn().mockResolvedValue({
  response: { text: () => '[ch]C[/ch] Mocked AI Chords' },
});
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    };
  }),
}));

// mock sentry
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

// set env vars
process.env.GEMINI_API_KEY = 'test_key';

describe('Extract Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // mock fetch
    vi.spyOn(securityUtil, 'secureFetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);

// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('api.acoustid.org')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [{ recordings: [{ id: 'mbid-123' }] }],
            }),
        } as globalThis.Response);
      }

// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('musicbrainz.org')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              isrcs: ['US1234567890'],
            }),
        } as globalThis.Response);
      }

// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('api.deezer.com')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              artist: { name: 'Deezer Artist' },
              title: 'Deezer Title',
            }),
        } as globalThis.Response);
      }

      if (urlStr.includes('lrclib.net/api/get')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              plainLyrics: 'Mocked Plain Lyrics',
              syncedLyrics: '[00:00.00] Mocked Synced Lyrics',
            }),
        } as globalThis.Response);
      }

      if (urlStr.includes('lrclib.net/api/search')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                plainLyrics: 'Mocked Search Lyrics',
              },
            ]),
        } as globalThis.Response);
      }

      return Promise.resolve({ ok: false } as globalThis.Response);
    });

    // mock ug
    vi.spyOn(ugService, 'getUgChords').mockResolvedValue({
      chordsSheet: '[ch]G[/ch] Mocked UG Chords',
      chordsLink: 'link',
      status: 'success',
    });
  });

  it('1. The Ultimate Happy Path (Primary Waterfall)', async () => {
    const result = await extractSongData('fake.mp3');

    expect(result.artist).toBe('Deezer Artist');
    expect(result.title).toBe('Deezer Title');
    expect(result.isrc).toBe('US1234567890');
    expect(result.lyrics).toBe('Mocked Plain Lyrics');
    expect(result.chordsSheet).toBe('[ch]G[/ch] Mocked UG Chords');
    expect(result.grounded).toBe(true);
  });

  it('2. The Shazam Fallback (AcoustID Failure - Zod Validation)', async () => {
    // force bad data
    vi.spyOn(securityUtil, 'secureFetch').mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: 'invalid_schema' }),
      } as globalThis.Response);
    });

    const result = await extractSongData('fake.mp3');

    expect(result.artist).toBe('Shazam Artist');
    expect(result.title).toBe('Shazam Title');
    expect(result.isrc).toBe('SHAZAM123');
  });

  it('3. The Shazam Fallback (fpcalc Failure)', async () => {
    // force fpcalc error
    const fpcalcMock = await import('fpcalc');
    (
      fpcalcMock.default as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce((_file: string, cb: (err: Error) => void) => {
      cb(new Error('fpcalc binary missing'));
    });

    const result = await extractSongData('fake.mp3');

    expect(result.artist).toBe('Shazam Artist');
  });

  it('4. The Complete Meltdown (All Extractors Fail)', async () => {
    // force fpcalc error
    const fpcalcMock = await import('fpcalc');
    (
      fpcalcMock.default as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce((_file: string, cb: (err: Error) => void) => {
      cb(new Error('fpcalc binary missing'));
    });

    // force shazam error
    const shazamMock = await import('node-shazam');
    (
      shazamMock.Shazam as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(function () {
      return {
        recognise: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
    });

    await expect(extractSongData('fake.mp3')).rejects.toThrow(
      'Shazam error: ECONNREFUSED'
    );
  });

  it('5. The Gemini AI Chords Fallback', async () => {
    // force ug fail
    vi.spyOn(ugService, 'getUgChords').mockResolvedValue(null);

    const engineChords = [{ chord: 'C', is_passing: false, time: 1.5 }];

    const result = await extractSongData('fake.mp3', engineChords);

    expect(result.grounded).toBe(false);
    expect(result.chordsSheet).toBe('[ch]C[/ch] Mocked AI Chords');
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it('6. LRCLIB Search Branches (Exact fails, Search succeeds)', async () => {
    let callCount = 0;
    vi.spyOn(securityUtil, 'secureFetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);

      // pass music pipeline
// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('api.acoustid.org'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [{ recordings: [{ id: 'mbid-123' }] }],
            }),
        } as globalThis.Response);
// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('musicbrainz.org'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ isrcs: ['US1'] }),
        } as globalThis.Response);
// codeql-disable js/incomplete-url-substring-sanitization
      if (urlStr.includes('api.deezer.com'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ artist: { name: 'Art' }, title: 'Tit (Remix)' }),
        } as globalThis.Response);

      // lrclib logic
      if (urlStr.includes('lrclib.net/api/get')) {
        return Promise.resolve({ ok: false } as globalThis.Response);
      }

      if (urlStr.includes('lrclib.net/api/search')) {
        callCount++;
        if (callCount === 1)
          return Promise.resolve({ ok: false } as globalThis.Response);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ plainLyrics: 'Fuzzy Search Lyrics' }]),
        } as globalThis.Response);
      }

      return Promise.resolve({ ok: false } as globalThis.Response);
    });

    const result = await extractSongData('fake.mp3');
    expect(result.lyrics).toBe('Fuzzy Search Lyrics');
  });
});
