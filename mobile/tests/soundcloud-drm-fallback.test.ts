import { describe, it, expect, vi, beforeEach } from 'vitest';

// net: client_id scrape + resolve
vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
}));
// youtube webview search + on-device extract, used by the isrc-match pipeline
vi.mock('../src/extractors/youtube/bridge', () => ({
  searchViaWebView: vi.fn(),
}));
vi.mock('../src/extractors/youtube/index', () => ({
  getInfo: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { searchViaWebView } from '../src/extractors/youtube/bridge';
import { getInfo as youtubeGetInfo } from '../src/extractors/youtube/index';
import { getInfo } from '../src/extractors/soundcloud';

const mockFetch = vi.mocked(gatedFetch);
const mockSearch = vi.mocked(searchViaWebView);
const mockYtInfo = vi.mocked(youtubeGetInfo);

function textRes(body: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}
function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const HOME =
  '<script crossorigin src="https://a-v2.sndcdn.com/assets/55-abc.js"></script>';
const ASSET = 'x={client_id:"abcdefghij1234567890ABCDEFGHIJ12"};';

// a major-label track: only encrypted (DRM) transcodings, but a full
// publisher_metadata block with the isrc labels always register.
const drmLabelTrack = {
  id: 313406845,
  title: 'You Are Good (Live)',
  duration: 322998,
  full_duration: 323004,
  policy: 'MONETIZE',
  user: { username: 'Israel Houghton' },
  artwork_url: 'https://i1.sndcdn.com/art-large.jpg',
  publisher_metadata: {
    isrc: 'US25L1100231',
    artist: 'Israel Houghton',
    album_title: 'Decade',
    release_title: 'You Are Good',
  },
  media: {
    transcodings: [
      {
        url: 'https://api-v2.soundcloud.com/media/x/ctr-encrypted-hls/drm',
        format: {
          protocol: 'ctr-encrypted-hls',
          mime_type: 'audio/mp4; codecs="mp4a.40.2"',
        },
      },
    ],
  },
};

function wireSc(trackBody: unknown) {
  mockFetch.mockImplementation((reqUrl: string) => {
    if (reqUrl === 'https://soundcloud.com/')
      return Promise.resolve(textRes(HOME));
    if (reqUrl.includes('/assets/')) return Promise.resolve(textRes(ASSET));
    if (reqUrl.includes('/resolve')) return Promise.resolve(jsonRes(trackBody));
    return Promise.resolve(textRes('', false));
  });
}

// a youtube extraction result with mixed formats; buildFromYoutube keeps audio
const ytResult = {
  type: 'video' as const,
  id: 'ytVideoId',
  title: 'Israel Houghton - You Are Good',
  uploader: 'IsraelHoughtonVEVO',
  webpageUrl: 'https://www.youtube.com/watch?v=ytVideoId',
  thumbnail: 'https://i.ytimg.com/yt.jpg',
  duration: 323,
  extractorKey: 'youtube',
  isJsInfo: true,
  fromBrain: false,
  isPartial: false,
  isIsrcMatch: false,
  isFullData: true,
  formats: [
    {
      formatId: 'a',
      url: 'https://yt/audio.m4a',
      extension: 'm4a',
      isAudio: true,
      isVideo: false,
      isMuxed: false,
    },
    {
      formatId: 'v',
      url: 'https://yt/video.mp4',
      extension: 'mp4',
      isAudio: false,
      isVideo: true,
      isMuxed: false,
    },
  ],
};

describe('soundcloud DRM → youtube isrc fallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSearch.mockReset();
    mockYtInfo.mockReset();
  });

  it('recovers a DRM-locked label track from youtube via its metadata', async () => {
    wireSc(drmLabelTrack);
    mockSearch.mockResolvedValue([
      {
        id: 'ytVideoId',
        title: 'You Are Good',
        author: 'Israel Houghton',
        durationSec: 323,
      },
    ]);
    mockYtInfo.mockResolvedValue(ytResult);

    const onPartial = vi.fn();
    const info = await getInfo(
      'https://soundcloud.com/israelhoughton/you-are-good',
      onPartial
    );

    expect(mockSearch).toHaveBeenCalledWith('Israel Houghton You Are Good');

    expect(mockYtInfo).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=ytVideoId'
    );

    expect(info).not.toBeNull();

    expect(info?.extractorKey).toBe('soundcloud');
    expect(info?.isIsrcMatch).toBe(true);
    expect(info?.title).toBe('You Are Good');
    expect(info?.uploader).toBe('Israel Houghton');
    expect(info?.album).toBe('Decade');
    expect(info?.duration).toBe(323);
    // youtube video streams stripped to audio-only
    expect(info?.formats).toHaveLength(1);
    expect(info?.formats[0].url).toBe('https://yt/audio.m4a');

    const paint = onPartial.mock.calls.at(-1)?.[0];
    expect(paint.isPartial).toBe(true);
    expect(paint.isIsrcMatch).toBe(true);
    expect(paint.title).toBe('You Are Good');
  });

  it('falls back to the DRM error when youtube has no match', async () => {
    wireSc(drmLabelTrack);
    mockSearch.mockResolvedValue(null); // nothing found on youtube

    await expect(
      getInfo('https://soundcloud.com/israelhoughton/you-are-good')
    ).rejects.toThrow(/DRM-protected/u);
    expect(mockYtInfo).not.toHaveBeenCalled();
  });

  it('falls back to the DRM error when no isrc/metadata to search with', async () => {
    wireSc({
      ...drmLabelTrack,
      title: undefined,
      user: {},
      publisher_metadata: undefined,
    });

    await expect(getInfo('https://soundcloud.com/x/locked')).rejects.toThrow(
      /DRM-protected/u
    );
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
