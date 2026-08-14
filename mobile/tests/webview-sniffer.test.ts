import { describe, it, expect } from 'vitest';
import {
  isMediaUrl,
  absoluteUrl,
  extensionOf,
  dedupeVideos,
  hashUrl,
  hlsVideosOf,
  parseHlsMessage,
  parseWebViewMessage,
  SNIFFER_JS,
  MEDIA_JUNK_RE,
  MEDIA_WIDE_RE,
} from '../src/lib/webviewExtraction/sniffer';
import { pageScanToVideoInfo } from '../src/lib/webviewExtraction/normalize';
import { DESKTOP_UA } from '../src/lib/userAgents';

describe('SNIFFER_JS page code', () => {
  it('is syntactically valid when interpolated', () => {
    // evaluating our own injected script string is the point of the test
    // eslint-disable-next-line sonarjs/code-eval
    expect(() => new Function(SNIFFER_JS)).not.toThrow();
  });

  it('keeps scanning until the page dies, not a fixed window', () => {
    expect(SNIFFER_JS).toContain('setInterval(collect, 1200)');
    expect(SNIFFER_JS).toContain('setTimeout(() => clearInterval(timer), 30000)');
  });

  it('walks same-origin frames, harvests embedded media, and filters failed probes', () => {
    expect(SNIFFER_JS).toContain('window.frames');
    expect(SNIFFER_JS).toContain('__phantom_failed_probes');
    expect(SNIFFER_JS).toContain('og:video');
    expect(SNIFFER_JS).toContain('outerHTML');
    expect(SNIFFER_JS).not.toContain('m4s');
  });

  it('embeds the hls manifest parser and the in-page fetcher', () => {
    expect(SNIFFER_JS).toContain('__phantom_hls');
    expect(SNIFFER_JS).toContain('hlsVideosOf');
    expect(SNIFFER_JS).toContain('EXT-X-STREAM-INF');
    expect(SNIFFER_JS).toContain('xhr.timeout = 8000');
  });
});

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,CODECS="avc1.640028"
https://cdn.example/hls/1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=854x480
480/index.m3u8`;

describe('hlsVideosOf', () => {
  it('parses master playlist variants with resolutions', () => {
    const videos = hlsVideosOf(MASTER, 'https://cdn.example/hls/master.m3u8');
    expect(videos).toEqual([
      { url: 'https://cdn.example/hls/1080/index.m3u8', type: 'm3u8', width: 1920, height: 1080 },
      { url: 'https://cdn.example/hls/720/index.m3u8', type: 'm3u8', width: 1280, height: 720 },
      { url: 'https://cdn.example/hls/480/index.m3u8', type: 'm3u8', width: 854, height: 480 },
    ]);
  });

  it('resolves relative variant uris against the manifest url', () => {
    const videos = hlsVideosOf(MASTER, 'https://cdn.example/hls/master.m3u8');
    expect(videos.map((v) => v.url)).toEqual([
      'https://cdn.example/hls/1080/index.m3u8',
      'https://cdn.example/hls/720/index.m3u8',
      'https://cdn.example/hls/480/index.m3u8',
    ]);
  });

  it('reports a media playlist itself as the stream', () => {
    const media = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
https://cdn.example/hls/seg-0.ts
#EXTINF:6.0,
https://cdn.example/hls/seg-1.ts`;
    expect(hlsVideosOf(media, 'https://cdn.example/hls/stream.m3u8')).toEqual([
      { url: 'https://cdn.example/hls/stream.m3u8', type: 'm3u8' },
    ]);
  });

  it.each([
    ['not a playlist', 'https://cdn.example/hls/master.m3u8'],
    ['<html>404 page</html>', 'https://cdn.example/hls/master.m3u8'],
    ['', 'https://cdn.example/hls/master.m3u8'],
  ])('rejects %s', (text, base) => {
    expect(hlsVideosOf(text, base)).toEqual([]);
  });

  it('skips non-http variant uris', () => {
    const blobMaster = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
blob:https://cdn.example/uuid`;
    expect(hlsVideosOf(blobMaster, 'https://cdn.example/hls/master.m3u8')).toEqual([]);
  });

  it('is case-insensitive on the playlist header and resolution', () => {
    const lower = MASTER.replace('#EXTM3U', '#extm3u').replace(
      'RESOLUTION=1920x1080',
      'resolution=1920x1080'
    );
    expect(hlsVideosOf(lower, 'https://cdn.example/hls/master.m3u8')[0]).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });
});

describe('parseHlsMessage', () => {
  it('parses an hls result message', () => {
    const raw = JSON.stringify({
      type: 'hls',
      data: {
        url: 'https://cdn.example/hls/master.m3u8',
        videos: [{ url: 'https://cdn.example/hls/1080/index.m3u8', type: 'm3u8' }],
      },
    });
    expect(parseHlsMessage(raw)).toEqual({
      url: 'https://cdn.example/hls/master.m3u8',
      videos: [{ url: 'https://cdn.example/hls/1080/index.m3u8', type: 'm3u8' }],
    });
  });

  it.each([
    ['garbage', null],
    [JSON.stringify({ type: 'pageScan' }), null],
    [JSON.stringify({ type: 'hls' }), null],
    [JSON.stringify({ type: 'hls', data: { url: 'u' } }), null],
    [JSON.stringify({ type: 'hls', data: { url: '', videos: [] } }), null],
  ])('%s → null', (input, expected) => {
    expect(parseHlsMessage(input)).toBe(expected);
  });
});

describe('MEDIA_JUNK_RE', () => {
  it.each([
    ['https://st-ok.cdn-vk.ru/res/js/MediaTopic_Hook_m78pne85.js', true],
    ['https://st-ok.cdn-vk.ru/res/js/VideoChatPush_oe5i85ep.js', true],
    ['https://c.example/style.css?v=2', true],
    ['https://c.example/thumb.png', true],
    ['https://c.example/font.woff2', true],
    ['https://c.example/state.json', true],
    ['https://c.example/video.mp4', false],
    ['https://c.example/stream.m3u8?q=1', false],
    ['https://c.example/page.html', true],
  ])('%s → %s', (url, expected) => {
    expect(MEDIA_JUNK_RE.test(url)).toBe(expected);
  });
});

describe('MEDIA_WIDE_RE', () => {
  it.each([
    ['https://ok.ru/video/12345', true],
    ['https://vu.odnoklassniki.ru/getmp4/abc/xyz', true],
    ['https://cdn.example/manifest.mpd', true],
    ['https://cdn.example/seg-1.ts', true],
    ['https://c.example/movie.mov', false],
    ['https://st-ok.cdn-vk.ru/res/js/MediaTopic_Hook.js', false],
    ['https://st-ok.cdn-vk.ru/res/js/VideoChatPush.js', false],
    ['https://st-ok.cdn-vk.ru/res/js/MediascopeTracker.js', false],
    ['https://c.example/mediathumb.png', false],
  ])('%s → %s', (url, expected) => {
    expect(MEDIA_WIDE_RE.test(url)).toBe(expected);
  });
});

describe('isMediaUrl', () => {
  it.each([
    ['https://x.com/v.mp4', true],
    ['https://x.com/v.m3u8?bandwidth=1', true],
    ['https://x.com/v.WEBM', true],
    ['https://x.com/v.mkv#frag', true],
    ['https://x.com/v.mov', true],
    ['https://x.com/v.mp3', false],
    ['https://x.com/v.mp4dd', false],
    ['https://x.com/watch', false],
  ])('%s → %s', (input, expected) => {
    expect(isMediaUrl(input)).toBe(expected);
  });
});

describe('absoluteUrl', () => {
  it('joins relative onto base', () => {
    expect(absoluteUrl('/media/v.mp4', 'https://x.com/a')).toBe(
      'https://x.com/media/v.mp4'
    );
  });

  it('keeps absolute urls as-is', () => {
    expect(absoluteUrl('https://x.com/v.mp4', 'https://y.com')).toBe(
      'https://x.com/v.mp4'
    );
  });

  it('returns input on unusable base', () => {
    expect(absoluteUrl('v.mp4', 'not a url')).toBe('v.mp4');
  });
});

describe('extensionOf', () => {
  it.each([
    ['https://x.com/v.mp4', 'mp4'],
    ['https://x.com/v.m3u8?q=1', 'm3u8'],
    ['https://x.com/v.MKV', 'mkv'],
    ['https://x.com/v?q=1', 'mp4'],
  ])('%s → %s', (input, expected) => {
    expect(extensionOf(input)).toBe(expected);
  });
});

describe('dedupeVideos', () => {
  it('drops duplicates and empty urls', () => {
    const videos = [
      { url: 'https://x.com/a.mp4' },
      { url: 'https://x.com/a.mp4' },
      { url: '', poster: 'https://x.com/p.jpg' },
      { url: 'https://x.com/b.mp4', poster: 'https://x.com/p.jpg' },
    ];
    expect(dedupeVideos(videos)).toEqual([
      { url: 'https://x.com/a.mp4' },
      { url: 'https://x.com/b.mp4', poster: 'https://x.com/p.jpg' },
    ]);
  });
});

describe('hashUrl', () => {
  it('is deterministic and stable', () => {
    expect(hashUrl('https://x.com/v')).toBe(hashUrl('https://x.com/v'));
  });

  it('differs across urls', () => {
    expect(hashUrl('https://x.com/a')).not.toBe(hashUrl('https://x.com/b'));
  });
});

describe('parseWebViewMessage', () => {
  it('parses a pageScan message', () => {
    const raw = JSON.stringify({
      type: 'pageScan',
      data: { url: 'https://x.com/p', title: 't', videos: [], images: [] },
    });
    expect(parseWebViewMessage(raw)).toEqual({
      url: 'https://x.com/p',
      title: 't',
      videos: [],
      images: [],
    });
  });

  it('passes cookies through from the page', () => {
    const raw = JSON.stringify({
      type: 'pageScan',
      data: {
        url: 'https://x.com/p',
        title: 't',
        videos: [],
        images: [],
        cookies: 'sid=abc',
      },
    });
    expect(parseWebViewMessage(raw)?.cookies).toBe('sid=abc');
  });

  it.each([
    ['garbage', null],
    [JSON.stringify({ type: 'ready' }), null],
    [JSON.stringify({ type: 'pageScan', data: { videos: [] } }), null],
    [JSON.stringify({ type: 'pageScan', data: { url: '', videos: [] } }), null],
  ])('%s → null', (input, expected) => {
    expect(parseWebViewMessage(input)).toBe(expected);
  });
});

describe('pageScanToVideoInfo', () => {
  const scan = {
    url: 'https://site.example/watch',
    title: '  Cool Clip  ',
    videos: [
      { url: 'https://site.example/media/hd.mp4' },
      { url: 'https://site.example/media/master.m3u8' },
      { url: 'https://site.example/media/hd.mp4' },
    ],
    images: [{ url: 'https://site.example/t.jpg' }],
  };

  it('returns null when no videos', () => {
    expect(
      pageScanToVideoInfo(
        { url: 'https://x.com', title: 'x', videos: [], images: [] },
        'x.com',
        false
      )
    ).toBeNull();
  });

  it('filters placeholder videos that echo the page url', () => {
    const placeholder = {
      url: 'https://site.example/watch',
      title: 't',
      videos: [
        { url: 'https://site.example/watch' },
        { url: 'https://site.example/media/hd.mp4' },
      ],
      images: [],
    };
    const info = pageScanToVideoInfo(placeholder, 'site.example', false);
    expect(info?.formats.map((format) => format.url)).toEqual([
      'https://site.example/media/hd.mp4',
    ]);
  });

  it('keeps the file when the url is a direct media paste', () => {
    const direct = {
      url: 'https://cdn.example/files/flower.mp4',
      title: '',
      videos: [{ url: 'https://cdn.example/files/flower.mp4' }],
      images: [],
      isDirect: true,
    };
    const info = pageScanToVideoInfo(direct, 'cdn.example', false);
    expect(info?.formats.map((format) => format.url)).toEqual([
      'https://cdn.example/files/flower.mp4',
    ]);
  });

  it('uses element dims as the quality label', () => {
    const withDims = {
      url: 'https://site.example/watch',
      title: 't',
      videos: [
        {
          url: 'https://site.example/media/hd.mp4',
          width: 1920,
          height: 1080,
        },
        { url: 'https://site.example/media/master.m3u8' },
      ],
      images: [],
    };
    const info = pageScanToVideoInfo(withDims, 'site.example', false);
    expect(info?.formats.map((format) => format.quality)).toEqual([
      'HLS',
      '1080p',
    ]);
    expect(info?.formats[1].width).toBe(1920);
    expect(info?.formats[1].height).toBe(1080);
  });

  it('builds a full info with hls first and headers', () => {
    const info = pageScanToVideoInfo(scan, 'site.example', false);
    expect(info).not.toBeNull();
    expect(info?.title).toBe('Cool Clip');
    expect(info?.uploader).toBe('site.example');
    expect(info?.webpageUrl).toBe(scan.url);
    expect(info?.extractorKey).toBe('webview');
    expect(info?.source).toBe('webview');
    expect(info?.isPartial).toBe(false);
    expect(info?.isFullData).toBe(true);
    expect(info?.formats).toHaveLength(2);
    expect(info?.formats[0].url).toContain('master.m3u8');
    expect(info?.formats[0].isHls).toBe(true);
    expect(info?.formats[0].extension).toBe('mp4');
    expect(info?.formats[1].url).toBe('https://site.example/media/hd.mp4');
    expect(info?.downloadHeaders).toEqual({
      'User-Agent': DESKTOP_UA,
      Referer: scan.url,
    });
  });

  it('marks partial scans', () => {
    const info = pageScanToVideoInfo(scan, 'site.example', true);
    expect(info?.isPartial).toBe(true);
    expect(info?.isFullData).toBe(false);
  });

  it('bridges page cookies into download headers', () => {
    const info = pageScanToVideoInfo(
      { ...scan, cookies: 'sid=abc123; pref=dark' },
      'site.example',
      false
    );
    expect(info?.downloadHeaders?.Cookie).toBe('sid=abc123; pref=dark');
  });

  it('prefers poster, then og:image, over first image', () => {
    const withPoster = pageScanToVideoInfo(
      { ...scan, videos: [{ url: 'https://site.example/media/hd.mp4', poster: 'https://site.example/poster.jpg' }] },
      'site.example',
      false
    );
    expect(withPoster?.thumbnail).toBe('https://site.example/poster.jpg');

    const withoutPoster = pageScanToVideoInfo(
      { ...scan, videos: scan.videos.slice(0, 2), ogImage: 'https://site.example/og.jpg' },
      'site.example',
      false
    );
    expect(withoutPoster?.thumbnail).toBe('https://site.example/og.jpg');
  });
});
