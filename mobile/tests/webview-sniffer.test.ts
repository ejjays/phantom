import { describe, it, expect } from 'vitest';
import {
  isMediaUrl,
  absoluteUrl,
  extensionOf,
  dedupeVideos,
  hashUrl,
  parseWebViewMessage,
} from '../src/lib/webviewExtraction/sniffer';
import { pageScanToVideoInfo } from '../src/lib/webviewExtraction/normalize';
import { DESKTOP_UA } from '../src/lib/userAgents';

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
