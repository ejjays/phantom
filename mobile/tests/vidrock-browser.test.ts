import { vi, describe, it, expect } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { vidrockToFormats, hasBlockedHosts } from '../src/extractors/movies/vidrock';
import { resolveWatchPageViaBrowser } from '../src/extractors/movies/browserProbe';

const mockedFetch = vi.mocked(gatedFetch);

function blockedResponse() {
  return {
    ok: false,
    status: 403,
    headers: { get: () => 'text/html' },
    text: () => Promise.resolve('<html><title>Just a moment...</title></html>'),
  } as unknown as Response;
}

describe('vidrock bot-block detection', () => {
  it('marks challenge hosts when probing fails', async () => {
    mockedFetch.mockResolvedValue(blockedResponse());
    const formats = await vidrockToFormats(
      [{ name: 'Orion', url: 'https://staticreverie.site/file1/abc', streamType: 'hls' }],
      0,
      { quick: true }
    );
    expect(formats).toEqual([]);
    expect(hasBlockedHosts()).toBe(true);
  });
});

describe('resolveWatchPageViaBrowser', () => {
  it('maps scanned videos to formats, hls first', async () => {
    const pageUrl = 'https://watchluna.gd/watch/movie/1';
    const found = await resolveWatchPageViaBrowser(pageUrl, () => Promise.resolve({
      url: pageUrl,
      title: 'Test',
      videos: [
        { url: pageUrl },
        { url: 'https://cdn.example/vid.mp4' },
        { url: 'https://cdn.example/master.m3u8' },
      ],
      images: [],
      cookies: 'session=abc',
    }));
    expect(found?.formats.map((format) => format.url)).toEqual([
      'https://cdn.example/master.m3u8',
      'https://cdn.example/vid.mp4',
    ]);
    expect(found?.cookies).toBe('session=abc');
  });

  it('returns null when the scan is empty', async () => {
    const found = await resolveWatchPageViaBrowser('https://watchluna.gd/watch/movie/1', () => Promise.resolve(null));
    expect(found).toBeNull();
  });

  it('follows player embeds when the page scan is empty', async () => {
    const pageUrl = 'https://watchluna.gd/watch/movie/1';
    const embedUrl = 'https://embed.example/play/1';
    const calls: string[] = [];
    const found = await resolveWatchPageViaBrowser(pageUrl, (url) => {
      calls.push(url);
      if (url === embedUrl) {
        return Promise.resolve({
          url: embedUrl,
          title: 'Embed',
          videos: [{ url: 'https://cdn.example/stream.m3u8' }],
          images: [],
        });
      }
      return Promise.resolve({
        url: pageUrl,
        title: 'Watch page',
        videos: [],
        images: [],
        frameUrls: ['https://www.google.com/recaptcha/api.js', embedUrl],
      });
    });
    expect(calls).toEqual([pageUrl, embedUrl]);
    expect(found?.formats.map((format) => format.url)).toEqual(['https://cdn.example/stream.m3u8']);
  });
});
