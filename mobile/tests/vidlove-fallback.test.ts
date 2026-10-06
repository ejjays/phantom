import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { getInfo } from '../src/extractors/movies';

const mockFetch = vi.mocked(gatedFetch);

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

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x800,CODECS="avc1.640028,mp4a.40.2"',
  'https://d.sublime.st/api?d=variant1080',
  '#EXT-X-STREAM-INF:BANDWIDTH=2300000,RESOLUTION=1280x534,CODECS="avc1.64001f,mp4a.40.2"',
  'https://d.sublime.st/api?d=variant720',
].join('\n');

const ORION_ENC =
  'Q0lqMnz1a1PjlCYOfIwhPBuDmgeXdwlAlQo5DuKb7-gpEJjWmnsROLHy5OpqAPKkkdCGVITTnp_1-hizyR0seRxc6GHxHOIWYj3muoJFfUts94CxHiK2n-spdvSyRWG8EoGGgHNeqlRbW5WjApCAYPKciaG4IuSrZEQHnKWboRWMEO8M5fCAWtfq';

const MASTER_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'https://cdn.example/1080.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  'https://cdn.example/720.m3u8',
].join('\n');

function playlistRes(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

describe('vidlove fallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_TMDB_API_KEY = '';
  });

  it('uses vidlove when vidrock has no sources', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(jsonRes({ Atlas: { url: null, type: null } }));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(
          jsonRes({
            source: {
              source: 'vidapi',
              label: 'VidAPI',
              url: 'https://a2.sublime.st/api?d=master',
              manifest: MASTER,
            },
          })
        );
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/550');
    expect(info?.formats.length).toBeGreaterThan(0);
    expect(info?.formats[0].formatId).toMatch(/vidlove/iu);
    expect(info?.formats[0].width).toBe(1920);
    expect(info?.formats[0].isHls).toBe(true);
    expect(info?.downloadHeaders?.Referer).toContain('player.vidlove.cc');
  });

  it('still throws when both providers are empty', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(jsonRes({ Atlas: { url: null, type: null } }));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(jsonRes({ source: null }));
      }
      return Promise.resolve(textRes('', false));
    });
    await expect(getInfo('https://watchluna.gd/movie/550')).rejects.toThrow(/downloadable/iu);
  });

  it('upgrades to vidlove when vidrock best is under 1080p', async () => {
    const master720 = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
      'https://cdn.example/720.m3u8',
    ].join('\n');
    const vlMaster = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      'https://d.sublime.st/api?d=variant1080',
    ].join('\n');
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(
          jsonRes({ Orion: { url: ORION_ENC, type: 'hls' } })
        );
      }
      if (target.includes('roguefrequency.live')) {
        return Promise.resolve(playlistRes(master720));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(
          jsonRes({
            source: {
              source: 'vidapi',
              label: 'VidAPI',
              url: 'https://a2.sublime.st/api?d=master',
              manifest: vlMaster,
            },
          })
        );
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/550');
    expect(info?.formats[0].formatId).toMatch(/vidlove/iu);
    expect(info?.downloadHeaders?.Referer).toContain('player.vidlove.cc');
  });

  it('prefers vidlove on 1080p ties', async () => {
    const vlMaster = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      'https://d.sublime.st/api?d=variant1080',
    ].join('\n');
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(
          jsonRes({ Orion: { url: ORION_ENC, type: 'hls' } })
        );
      }
      if (target.includes('roguefrequency.live')) {
        return Promise.resolve(playlistRes(MASTER_PLAYLIST));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(
          jsonRes({
            source: {
              source: 'vidapi',
              label: 'VidAPI',
              url: 'https://a2.sublime.st/api?d=master',
              manifest: vlMaster,
            },
          })
        );
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/550');
    expect(info?.formats[0].formatId).toMatch(/vidlove/iu);
  });

  it('keeps vidrock when vidlove has nothing', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(
          jsonRes({ Orion: { url: ORION_ENC, type: 'hls' } })
        );
      }
      if (target.includes('roguefrequency.live')) {
        return Promise.resolve(playlistRes(MASTER_PLAYLIST));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(jsonRes({ source: null }));
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/550');
    expect(info?.formats[0].formatId).toMatch(/vidrock/iu);
  });

  it('maps moviebox qualities to labeled formats', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('vidrock.net/api/')) {
        return Promise.resolve(jsonRes({}));
      }
      if (target.includes('api.vidlove.cc/movie')) {
        return Promise.resolve(
          jsonRes({
            source: {
              source: 'moviebox',
              label: 'MovieBox',
              url: 'https://d.sublime.st/api?d=auto',
              qualities: [{ quality: '1080p', codec: 'h264', url: 'https://d.sublime.st/api?d=q1080' }],
            },
          })
        );
      }
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://watchluna.gd/movie/1599191');
    const ids = (info?.formats ?? []).map((f) => f.formatId);
    expect(ids.some((id) => id.includes('vidlove-moviebox-1080p'))).toBe(true);
  });
});
