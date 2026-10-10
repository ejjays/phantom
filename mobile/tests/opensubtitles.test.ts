import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../src/lib/net';
import { fetchOpenSubtitles, fetchOpenSubtitlesByHash } from '../src/extractors/movies/opensubtitles';

const mockedFetch = vi.mocked(fetchWithTimeout);

function entry(fileId: number, opts?: { hi?: boolean; foreign?: boolean; season?: number; episode?: number }) {
  return {
    attributes: {
      language: 'en',
      hearing_impaired: opts?.hi ?? false,
      foreign_parts_only: opts?.foreign ?? false,
      files: [{ file_id: fileId }],
      feature_details: { season_number: opts?.season ?? 1, episode_number: opts?.episode ?? 1 },
    },
  };
}

function okSearchOnce(entries: unknown[]) {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: entries }),
  } as Response);
}

function okDownloadOnce(link = 'https://dl.osdb.link/abc.srt') {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ link }),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXPO_PUBLIC_OS_API_KEY = 'test-key';
});

describe('fetchOpenSubtitles', () => {
  it('searches, downloads and returns the track', async () => {
    okSearchOnce([entry(111), entry(222)]);
    okDownloadOnce();
    const tracks = await fetchOpenSubtitles({
      kind: 'tv',
      tmdbId: '62715',
      season: '1',
      episode: '1',
    });
    expect(tracks).toEqual([
      { label: 'English', lang: 'en', url: 'https://dl.osdb.link/abc.srt' },
    ]);
    const searchUrl = String(mockedFetch.mock.calls[0]?.[0] ?? '');
    expect(searchUrl).toContain('parent_tmdb_id=62715');
    expect(searchUrl).toContain('season_number=1');
    const dlBody = mockedFetch.mock.calls[1]?.[1] as { body?: string };
    expect(dlBody?.body).toContain('111');
  });

  it('prefers non-HI tracks', async () => {
    okSearchOnce([entry(111, { hi: true }), entry(222)]);
    okDownloadOnce();
    const tracks = await fetchOpenSubtitles({
      kind: 'movie',
      tmdbId: '550',
    });
    expect(tracks[0]?.url).toBe('https://dl.osdb.link/abc.srt');
    const dlBody = mockedFetch.mock.calls[1]?.[1] as { body?: string };
    expect(dlBody?.body).toContain('222');
  });

  it('returns empty without an api key', async () => {
    delete process.env.EXPO_PUBLIC_OS_API_KEY;
    const tracks = await fetchOpenSubtitles({
      kind: 'tv',
      tmdbId: '62715',
      season: '1',
      episode: '1',
    });
    expect(tracks).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns empty when search finds nothing', async () => {
    okSearchOnce([]);
    const tracks = await fetchOpenSubtitles({
      kind: 'movie',
      tmdbId: '550',
    });
    expect(tracks).toEqual([]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('resolves hash-matched subtitles', async () => {
    okSearchOnce([entry(777)]);
    okDownloadOnce();
    const tracks = await fetchOpenSubtitlesByHash('abcdef1234567890', 700000000);
    expect(tracks).toEqual([
      { label: 'English', lang: 'en', url: 'https://dl.osdb.link/abc.srt' },
    ]);
    const searchUrl = String(mockedFetch.mock.calls[0]?.[0] ?? '');
    expect(searchUrl).toContain('moviehash=abcdef1234567890');
    expect(searchUrl).toContain('moviebytesize=700000000');
  });
});
