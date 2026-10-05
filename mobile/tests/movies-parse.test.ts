import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { getInfo } from '../src/extractors/movies';
import { parseMovieUrl } from '../src/extractors/movies/parse';
import { decryptVidrockPayload } from '../src/extractors/movies/aesgcm';

const mockFetch = vi.mocked(gatedFetch);

const KEY = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
const NOVA_ENC =
  '32dcbDVqnaoLrEKqZGYDnTuwOgQgYupjuUrtbYxH7Eb_E7zXq6rVXNZBFTYBVMWm1e2kiw5vnikIY3O5CyWT39wk04ZnUxC9HsZ_mvIuOelBa1CeUmmr-dKdDgDjdMV9_ef3VbHLOE1S4VgVI0FDFT9himR0H394tKM';
const ORION_ENC =
  'Q0lqMnz1a1PjlCYOfIwhPBuDmgeXdwlAlQo5DuKb7-gpEJjWmnsROLHy5OpqAPKkkdCGVITTnp_1-hizyR0seRxc6GHxHOIWYj3muoJFfUts94CxHiK2n-spdvSyRWG8EoGGgHNeqlRbW5WjApCAYPKciaG4IuSrZEQHnKWboRWMEO8M5fCAWtfq';

const NOVA_URL = 'https://cdn.ngcorp.dad/movie/dXzi-QzFxXuGNkuKPWHpYpV7zLX_w5hK2_oVxM3q4D4.I7EGXjzO/bigtits.m3u8';
const ORION_URL =
  'https://roguefrequency.live/file1/ZGEzZjlmZjQxNGJmMmExNWUxYzNhZDg5Yjc2OTI3OTYxNzg5NjQyNDk0MjExMTcy/master.m3u8';

const MOVIE_HTML = `<!doctype html><html><head><title>Watch Your Fault: London | Online HD | Watchluna</title>
<meta property="og:image" content="https://image.tmdb.org/t/p/w500/nLxu237EJAisFCYKK48hN9Plobx.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"Your Fault: London","description":"Nick and Noah","image":"https://image.tmdb.org/t/p/w500/nLxu237EJAisFCYKK48hN9Plobx.jpg","duration":"PT123M"}</script>
</head><body></body></html>`;

const MEDIA_PLAYLIST = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXTINF:10.0,', 'https://seg.example/1.ts'].join('\n');

const MASTER_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'https://cdn.example/1080.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  'https://cdn.example/720.m3u8',
].join('\n');

const VARIANT_MEDIA = [
  '#EXTM3U',
  '#EXTINF:10,',
  'https://seg.example/v-0.ts',
  '#EXTINF:10,',
  'https://seg.example/v-1.ts',
  '#EXTINF:10,',
  'https://seg.example/v-2.ts',
  '#EXTINF:10,',
  'https://seg.example/v-3.ts',
].join('\n');

function textRes(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) } as unknown as Response;
}

function jsonRes(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

function playlistRes(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

describe('parseMovieUrl', () => {
  it.each([
    ['https://watchluna.gd/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.gd/watch/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://www.watchluna.gd/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.to/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.to/watch/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.io/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.io/tv/1399/2/3', { kind: 'tv', tmdbId: '1399', season: '2', episode: '3' }],
    [
      'https://watchluna.com/movies/watch-your-fault-london-online-free-1477317',
      { kind: 'movie', tmdbId: '1477317' },
    ],
  ])('parses movie %s', (url, expected) => {
    expect(parseMovieUrl(url)).toEqual(expected);
  });

  it.each([
    ['https://watchluna.gd/tv/1399/1/2', { kind: 'tv', tmdbId: '1399', season: '1', episode: '2' }],
    ['https://watchluna.gd/watch/tv/1399/1/2', { kind: 'tv', tmdbId: '1399', season: '1', episode: '2' }],
  ])('parses tv %s', (url, expected) => {
    expect(parseMovieUrl(url)).toEqual(expected);
  });

  it('returns null for non-luna hosts', () => {
    expect(parseMovieUrl('https://example.com/movie/1477317')).toBeNull();
    expect(parseMovieUrl('not a url')).toBeNull();
  });
});

describe('decryptVidrockPayload', () => {
  it('decrypts the nova entry to its hls url', () => {
    expect(decryptVidrockPayload(NOVA_ENC, KEY)).toBe(NOVA_URL);
  });

  it('decrypts the orion entry to its master url', () => {
    expect(decryptVidrockPayload(ORION_ENC, KEY)).toBe(ORION_URL);
  });

  it('rejects tampered payloads', () => {
    expect(() => decryptVidrockPayload(`${NOVA_ENC.slice(0, -2)}AB`, KEY)).toThrow();
  });
});

function headRes(contentType: string, length: number): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name === 'content-type'
          ? contentType
          : name === 'content-length'
            ? String(length)
            : null,
    },
  } as unknown as Response;
}

describe('movies getInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
  });

  function mockHappy(): void {
    mockFetch.mockImplementation((reqUrl: unknown, init?: RequestInit) => {
      const target = String(reqUrl);
      if (target.includes('api.themoviedb.org/3/movie/')) {
        return Promise.resolve(
          jsonRes({
            title: 'Your Fault: London',
            poster_path: '/nLxu237EJAisFCYKK48hN9Plobx.jpg',
            backdrop_path: '/backdrop.jpg',
            release_date: '2024-01-01',
            vote_average: 7,
            vote_count: 100,
            genres: [{ name: 'Drama' }],
            overview: 'Nick and Noah',
            runtime: 123,
          })
        );
      }
      if (target.includes('watchluna.gd/movie/')) return Promise.resolve(textRes(MOVIE_HTML));
      if (target.includes('vidrock.net/api/movie/')) {
        return Promise.resolve(
          jsonRes({
            Nova: { url: NOVA_ENC, type: 'hls' },
            Orion: { url: ORION_ENC, type: 'hls' },
            Atlas: { url: null, type: null },
          })
        );
      }
      if (target.includes('cdn.ngcorp.dad')) return Promise.resolve(playlistRes(MEDIA_PLAYLIST));
      if (target.includes('roguefrequency.live')) return Promise.resolve(playlistRes(MASTER_PLAYLIST));
      if (target.includes('cdn.example/')) return Promise.resolve(playlistRes(VARIANT_MEDIA));
      if (target.includes('seg.example') && init?.method === 'HEAD') {
        return Promise.resolve(headRes('video/mp2t', 300000));
      }
      return Promise.resolve(textRes('', false));
    });
  }

  it('builds 1080p formats from vidrock master + media playlists', async () => {
    mockHappy();
    const info = await getInfo('https://watchluna.gd/watch/movie/1477317');
    expect(info?.title).toBe('Your Fault: London');
    expect(info?.extractorKey).toBe('phantom');
    expect(info?.thumbnail).toContain('image.tmdb.org');
    expect(info?.duration).toBe(7380);
    const ids = (info?.formats ?? []).map((f) => f.formatId);
    expect(ids.some((id) => id.includes('1080p'))).toBe(true);
    expect(info?.formats[0].height).toBe(1080);
    expect(info?.formats[0].isHls).toBe(true);
    const nova = info?.formats.find((f) => f.formatId.includes('nova'));
    expect(nova?.filesize).toBe(300000);
  });

  it('uses playlist claims for variant sizes instead of probing segments', async () => {
    mockHappy();
    const info = await getInfo('https://watchluna.gd/watch/movie/1477317');
    const orion1080 = info?.formats.find((f) => f.formatId.includes('orion-1080p'));
    expect(orion1080?.filesize).toBeGreaterThan(1000000000);
  });

  it('skips sources whose segments already serve placeholders', async () => {
    mockHappy();
    mockFetch.mockImplementation((reqUrl: unknown, init?: RequestInit) => {
      const target = String(reqUrl);
      if (target.includes('watchluna.gd/movie/')) return Promise.resolve(textRes(MOVIE_HTML));
      if (target.includes('vidrock.net/api/movie/')) {
        return Promise.resolve(
          jsonRes({
            Nova: { url: NOVA_ENC, type: 'hls' },
            Orion: { url: ORION_ENC, type: 'hls' },
          })
        );
      }
      if (target.includes('cdn.ngcorp.dad')) return Promise.resolve(playlistRes(MEDIA_PLAYLIST));
      if (target.includes('roguefrequency.live')) return Promise.resolve(playlistRes(MASTER_PLAYLIST));
      if (target.includes('seg.example') && init?.method === 'HEAD') {
        return Promise.resolve(headRes('image/png', 618214));
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/1477317');
    const ids = (info?.formats ?? []).map((f) => f.formatId);
    expect(ids.some((id) => id.includes('nova'))).toBe(false);
    expect(ids.some((id) => id.includes('1080p'))).toBe(true);
  });

  it('resolves the legacy watchluna.com movie slug', async () => {
    mockHappy();
    const info = await getInfo(
      'https://watchluna.com/movies/watch-your-fault-london-online-free-1477317'
    );
    expect(info?.id).toBe('1477317');
    expect(info?.formats.length).toBeGreaterThan(0);
  });

  it('emits a partial before sources resolve', async () => {
    mockHappy();
    const partials: string[] = [];
    await getInfo('https://watchluna.gd/movie/1477317', (info) => {
      partials.push(info.title);
    });
    expect(partials).toEqual(['Your Fault: London']);
  });

  it('throws a typed error when vidrock has no sources', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('watchluna.gd/movie/')) return Promise.resolve(textRes(MOVIE_HTML));
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(jsonRes({ Atlas: { url: null, type: null } }));
      }
      return Promise.resolve(textRes('', false));
    });
    await expect(getInfo('https://watchluna.gd/movie/1477317')).rejects.toThrow(/downloadable/iu);
  });

  it('falls back to the canonical host when the pasted domain fails meta', async () => {
    mockHappy();
    const info = await getInfo('https://watchluna.to/movie/1477317');
    expect(info?.title).toBe('Your Fault: London');
    expect(info?.formats.length).toBeGreaterThan(0);
  });

  it('decodes entities in titles exactly once', async () => {
    const { parseMovieMeta } = await import('../src/extractors/movies/parse');
    expect(parseMovieMeta('<title>A &amp; B | Watchluna</title>', '1').title).toBe('A & B');
    expect(parseMovieMeta('<title>A &amp;lt; B | Watchluna</title>', '1').title).toBe('A &lt; B');
  });

  it('returns null for non-luna urls', async () => {
    expect(await getInfo('https://example.com/movie/1477317')).toBeNull();
  });
});
