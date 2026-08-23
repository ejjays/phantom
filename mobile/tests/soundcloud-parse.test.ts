import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  timeoutSignal: (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  },
}));

import { gatedFetch } from '../src/lib/net';
import { getInfo } from '../src/extractors/soundcloud';

const mockFetch = vi.mocked(gatedFetch);

function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}
function textRes(body: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}
function headRes(size: number): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => (/content-length/iu.test(k) ? String(size) : null),
    },
  } as unknown as Response;
}

const HOME =
  '<script crossorigin src="https://a-v2.sndcdn.com/assets/55-abc.js"></script>';
const ASSET = 'x={client_id:"abcdefghij1234567890ABCDEFGHIJ12"};';
const STREAM = 'https://cf-media.sndcdn.com/track.128.mp3?Policy=sig';

const track = (protocol: string, mime: string, extra: object = {}) => ({
  id: 12345,
  title: 'a lofi track',
  duration: 200000,
  full_duration: 200000,
  policy: 'ALLOW',
  user: { username: 'beatmaker' },
  artwork_url: 'https://i1.sndcdn.com/art-large.jpg',
  media: {
    transcodings: [
      {
        url: `https://api-v2.soundcloud.com/media/x/${protocol}`,
        format: { protocol, mime_type: mime },
      },
    ],
  },
  ...extra,
});

function wire(trackBody: unknown, streamUrl = STREAM) {
  mockFetch.mockImplementation((reqUrl, init) => {
    if (init?.method === 'HEAD') return Promise.resolve(headRes(4600000));
    if (reqUrl === 'https://soundcloud.com/')
      return Promise.resolve(textRes(HOME));
    if (reqUrl.includes('/assets/')) return Promise.resolve(textRes(ASSET));
    if (reqUrl.includes('/resolve')) return Promise.resolve(jsonRes(trackBody));
    if (reqUrl.includes('/media/'))
      return Promise.resolve(jsonRes({ url: streamUrl }));
    return Promise.resolve(textRes('', false));
  });
}

describe('soundcloud getInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('resolves a progressive track to a direct mp3', async () => {
    wire(track('progressive', 'audio/mpeg'));
    const onPartial = vi.fn();
    const info = await getInfo(
      'https://soundcloud.com/beatmaker/a-lofi-track',
      onPartial
    );

    // early hit: picker painted before stream resolves
    expect(onPartial).toHaveBeenCalledTimes(1);
    const early = onPartial.mock.calls[0][0];
    expect(early.isPartial).toBe(true);
    expect(early.title).toBe('a lofi track');
    expect(early.uploader).toBe('beatmaker');
    expect(early.formats).toHaveLength(0);

    expect(info).not.toBeNull();
    expect(info?.extractorKey).toBe('soundcloud');
    expect(info?.uploader).toBe('beatmaker');
    expect(info?.duration).toBe(200);
    const fmt = info?.formats[0];
    expect(fmt?.extension).toBe('mp3');
    expect(fmt?.url).toBe(STREAM);
    expect(fmt?.isHls).toBeUndefined();
    expect(fmt?.noTranscode).toBe(true);
    expect(fmt?.filesize).toBe(4600000);
  });

  it('falls back to an HLS m4a when no progressive exists', async () => {
    const m3u8 =
      'https://playback.media-streaming.soundcloud.cloud/x/aac/p.m3u8';
    wire(track('hls', 'audio/mp4; codecs="mp4a.40.2"'), m3u8);
    const info = await getInfo('https://soundcloud.com/beatmaker/hls-only');

    const fmt = info?.formats[0];
    expect(fmt?.extension).toBe('m4a');
    expect(fmt?.isHls).toBe(true);
    expect(fmt?.url).toBe(m3u8);
  });

  it('rejects a preview snippet', async () => {
    wire(track('progressive', 'audio/mpeg', { policy: 'SNIPPET' }));
    await expect(
      getInfo('https://soundcloud.com/beatmaker/snippet')
    ).rejects.toThrow(/preview only/iu);
  });

  // major-label tracks list plain progressive/hls transcodings whose
  // stream-resolve 404s; only cbc/ctr-encrypted-hls actually work.
  const labelTrack = (deadProtocols: string[]) => ({
    ...track('progressive', 'audio/mpeg'),
    media: {
      transcodings: [
        ...deadProtocols.map((protocol) => ({
          url: `https://api-v2.soundcloud.com/media/x/${protocol}/dead`,
          format: {
            protocol,
            mime_type: protocol === 'progressive' ? 'audio/mpeg' : 'audio/mp4',
          },
        })),
        {
          url: 'https://api-v2.soundcloud.com/media/x/ctr-encrypted-hls/drm',
          format: {
            protocol: 'ctr-encrypted-hls',
            mime_type: 'audio/mp4; codecs="mp4a.40.2"',
          },
        },
      ],
    },
  });

  it('reports DRM when every plain transcoding 404s at stream-resolve', async () => {
    wire(labelTrack(['progressive', 'hls']));
    // /media/ requests for the dead transcodings 404 like the real api
    mockFetch.mockImplementation((reqUrl, init) => {
      if (init?.method === 'HEAD') return Promise.resolve(headRes(1));
      if (reqUrl === 'https://soundcloud.com/')
        return Promise.resolve(textRes(HOME));
      if (reqUrl.includes('/assets/')) return Promise.resolve(textRes(ASSET));
      if (reqUrl.includes('/resolve'))
        return Promise.resolve(jsonRes(labelTrack(['progressive', 'hls'])));
      if (reqUrl.includes('/media/'))
        return Promise.resolve(textRes('{}', false));
      return Promise.resolve(textRes('', false));
    });
    await expect(
      getInfo('https://soundcloud.com/label/locked-track')
    ).rejects.toThrow(/DRM-protected/u);
  });

  it('reports DRM when only encrypted transcodings are listed', async () => {
    const drmOnly = labelTrack([]);
    wire(drmOnly);
    await expect(
      getInfo('https://soundcloud.com/label/drm-only')
    ).rejects.toThrow(/DRM-protected/u);
  });

  it('falls through a dead progressive to a live hls transcoding', async () => {
    const m3u8 =
      'https://playback.media-streaming.soundcloud.cloud/x/aac/p.m3u8';
    const mixed = {
      ...track('progressive', 'audio/mpeg'),
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/x/progressive/dead',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
          {
            url: 'https://api-v2.soundcloud.com/media/x/hls/live',
            format: {
              protocol: 'hls',
              mime_type: 'audio/mp4; codecs="mp4a.40.2"',
            },
          },
        ],
      },
    };
    mockFetch.mockImplementation((reqUrl, init) => {
      if (init?.method === 'HEAD') return Promise.resolve(headRes(1));
      if (reqUrl === 'https://soundcloud.com/')
        return Promise.resolve(textRes(HOME));
      if (reqUrl.includes('/assets/')) return Promise.resolve(textRes(ASSET));
      if (reqUrl.includes('/resolve')) return Promise.resolve(jsonRes(mixed));
      if (reqUrl.includes('/progressive/dead'))
        return Promise.resolve(textRes('{}', false));
      if (reqUrl.includes('/hls/live'))
        return Promise.resolve(jsonRes({ url: m3u8 }));
      return Promise.resolve(textRes('', false));
    });
    const info = await getInfo('https://soundcloud.com/beatmaker/mixed');
    const fmt = info?.formats[0];
    expect(fmt?.url).toBe(m3u8);
    expect(fmt?.extension).toBe('m4a');
    expect(fmt?.isHls).toBe(true);
  });
});
