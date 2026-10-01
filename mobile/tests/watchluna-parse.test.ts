import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { getInfo } from '../src/extractors/watchluna';
import { parseWatchlunaUrl } from '../src/extractors/watchluna/parse';
import { decryptVidrockPayload } from '../src/extractors/watchluna/aesgcm';

const mockFetch = vi.mocked(gatedFetch);

const KEY = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
const NOVA_ENC =
  '32dcbDVqnaoLrEKqZGYDnTuwOgQgYupjuUrtbYxH7Eb_E7zXq6rVXNZBFTYBVMWm1e2kiw5vnikIY3O5CyWT39wk04ZnUxC9HsZ_mvIuOelBa1CeUmmr-dKdDgDjdMV9_ef3VbHLOE1S4VgVI0FDFT9himR0H394tKM';
const ORION_ENC =
  'Q0lqMnz1a1PjlCYOfIwhPBuDmgeXdwlAlQo5DuKb7-gpEJjWmnsROLHy5OpqAPKkkdCGVITTnp_1-hizyR0seRxc6GHxHOIWYj3muoJFfUts94CxHiK2n-spdvSyRWG8EoGGgHNeqlRbW5WjApCAYPKciaG4IuSrZEQHnKWboRWMEO8M5fCAWtfq';

const NOVA_URL = 'https://cdn.ngcorp.dad/movie/dXzi-QzFxXuGNkuKPWHpYpV7zLX_w5hK2_oVxM3q4D4.I7EGXjzO/bigtits.m3u8';
const ORION_URL =
  'https://roguefrequency.live/file1/ZGEzZjlmZjQxNGJmMmExNWUxYzNhZDg5Yjc2OTI3OTYxNzg5NjQyNDk0MjExMTcy/master.m3u8';

const LUNA_HTML = `<!doctype html><html><head><title>Watch Your Fault: London | Online HD | Watchluna</title>
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

describe('parseWatchlunaUrl', () => {
  it.each([
    ['https://watchluna.gd/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://watchluna.gd/watch/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    ['https://www.watchluna.gd/movie/1477317', { kind: 'movie', tmdbId: '1477317' }],
    [
      'https://watchluna.com/movies/watch-your-fault-london-online-free-1477317',
      { kind: 'movie', tmdbId: '1477317' },
    ],
  ])('parses movie %s', (url, expected) => {
    expect(parseWatchlunaUrl(url)).toEqual(expected);
  });

  it.each([
    ['https://watchluna.gd/tv/1399/1/2', { kind: 'tv', tmdbId: '1399', season: '1', episode: '2' }],
    ['https://watchluna.gd/watch/tv/1399/1/2', { kind: 'tv', tmdbId: '1399', season: '1', episode: '2' }],
  ])('parses tv %s', (url, expected) => {
    expect(parseWatchlunaUrl(url)).toEqual(expected);
  });

  it('returns null for non-luna hosts', () => {
    expect(parseWatchlunaUrl('https://example.com/movie/1477317')).toBeNull();
    expect(parseWatchlunaUrl('not a url')).toBeNull();
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

describe('watchluna getInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockHappy(): void {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('watchluna.gd/movie/')) return Promise.resolve(textRes(LUNA_HTML));
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
      return Promise.resolve(textRes('', false));
    });
  }

  it('builds 1080p formats from vidrock master + media playlists', async () => {
    mockHappy();
    const info = await getInfo('https://watchluna.gd/watch/movie/1477317');
    expect(info?.title).toBe('Your Fault: London');
    expect(info?.extractorKey).toBe('watchluna');
    expect(info?.thumbnail).toContain('image.tmdb.org');
    expect(info?.duration).toBe(7380);
    const ids = (info?.formats ?? []).map((f) => f.formatId);
    expect(ids.some((id) => id.includes('1080p'))).toBe(true);
    expect(info?.formats[0].height).toBe(1080);
    expect(info?.formats[0].isHls).toBe(true);
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
      if (target.includes('watchluna.gd/movie/')) return Promise.resolve(textRes(LUNA_HTML));
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(jsonRes({ Atlas: { url: null, type: null } }));
      }
      return Promise.resolve(textRes('', false));
    });
    await expect(getInfo('https://watchluna.gd/movie/1477317')).rejects.toThrow(/downloadable/iu);
  });

  it('returns null for non-luna urls', async () => {
    expect(await getInfo('https://example.com/movie/1477317')).toBeNull();
  });
});
