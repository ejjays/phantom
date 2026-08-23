import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  timeoutSignal: (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  },
  mapLimit: <T>(
    items: T[],
    _limit: number,
    task: (item: T) => Promise<unknown>
  ) => Promise.all(items.map(task)),
}));

import { gatedFetch } from '../src/lib/net';
import { getInfo } from '../src/extractors/reddit';

const mockFetch = vi.mocked(gatedFetch);

function textRes(body: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 403,
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

const HTML = `
<html><head>
<meta property="og:title" content="3 guys attacked random jeep passengers" />
<meta property="og:image" content="https://external-preview.redd.it/abc.png?width=640&amp;s=sig" />
</head><body>
<div class="thing" data-author="WashHappy5391" data-url="https://v.redd.it/yzxzty7ymd9h1" data-permalink="/r/pinoy/comments/1uf2nx8/x/"></div>
</body></html>`;

// mirrors real reddit mpd (CMAF names, audio rep quirk)
const MPD = `<?xml version="1.0"?>
<MPD mediaPresentationDuration="PT1M30.071625S">
<Period>
<AdaptationSet contentType="video">
<Representation bandwidth="259050" height="392" id="5" mimeType="video/mp4" width="220"><BaseURL>CMAF_220.mp4</BaseURL></Representation>
<Representation bandwidth="465242" height="480" id="6" mimeType="video/mp4" width="270"><BaseURL>CMAF_270.mp4</BaseURL></Representation>
<Representation bandwidth="2418190" height="1280" id="9" mimeType="video/mp4" width="720"><BaseURL>CMAF_720.mp4</BaseURL></Representation>
</AdaptationSet>
<AdaptationSet contentType="audio">
<Representation audioSamplingRate="48000" bandwidth="68438" id="10" mimeType="audio/mp4"><AudioChannelConfiguration value="2" /><BaseURL>CMAF_AUDIO_64.mp4</BaseURL></Representation>
<Representation audioSamplingRate="48000" bandwidth="132577" id="11" mimeType="audio/mp4"><AudioChannelConfiguration value="2" /><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation>
</AdaptationSet>
</Period>
</MPD>`;

describe('reddit getInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('parses all qualities + audio from a v.redd.it post', async () => {
    mockFetch.mockImplementation((url, init) => {
      if (init?.method === 'HEAD') {
        const size = /AUDIO/u.test(url)
          ? 1467810
          : /CMAF_720/u.test(url)
            ? 20714387
            : /CMAF_270/u.test(url)
              ? 5000000
              : 3000000;
        return Promise.resolve(headRes(size));
      }
      if (/DASHPlaylist\.mpd/u.test(url)) return Promise.resolve(textRes(MPD));
      return Promise.resolve(textRes(HTML));
    });

    const info = await getInfo(
      'https://www.reddit.com/r/pinoy/comments/1uf2nx8/x/'
    );

    expect(info).not.toBeNull();
    expect(info?.extractorKey).toBe('reddit');
    expect(info?.title).toBe('3 guys attacked random jeep passengers');
    expect(info?.uploader).toBe('WashHappy5391');
    expect(info?.duration).toBe(90);

    expect(info?.formats).toHaveLength(3);
    const top = info?.formats[0];
    expect(top?.formatId).toBe('720p');
    expect(top?.url).toBe('https://v.redd.it/yzxzty7ymd9h1/CMAF_720.mp4');
    expect(top?.resolution).toBe('720x1280');
    // highest-bitrate audio chosen, muxed on-device
    expect(top?.muxAudioUrl).toBe(
      'https://v.redd.it/yzxzty7ymd9h1/CMAF_AUDIO_128.mp4'
    );
    expect(top?.isMuxed).toBe(false);
    expect(top?.filesize).toBe(20714387 + 1467810);
  });

  it('returns a silent video when the mpd has no audio track', async () => {
    const noAudio = MPD.replace(
      /<AdaptationSet contentType="audio">[\s\S]*?<\/AdaptationSet>/u,
      ''
    );
    mockFetch
      .mockResolvedValueOnce(textRes(HTML))
      .mockResolvedValueOnce(textRes(noAudio));

    const info = await getInfo(
      'https://www.reddit.com/r/x/comments/1uf2nx8/y/'
    );
    expect(info?.formats[0].muxAudioUrl).toBeUndefined();
    expect(info?.formats[0].isMuxed).toBe(true);
  });

  it('throws when the post has no v.redd.it video', async () => {
    mockFetch.mockResolvedValueOnce(
      textRes(
        '<html><head></head><body><div data-url="https://i.redd.it/x.jpg"></div></body></html>'
      )
    );

    await expect(
      getInfo('https://www.reddit.com/r/x/comments/abc/img/')
    ).rejects.toThrow(/downloadable video/iu);
  });
});
