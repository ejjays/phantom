import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

import { resolveLunaWatchPage } from '../src/extractors/movies/browserProbe';
import type { PageScan } from '../src/lib/webviewExtraction/sniffer';

function scanOf(urls: string[]): PageScan {
  return {
    url: 'https://watchluna.gd/watch/tv/62715/1/1',
    title: 'Watch Dragon Ball Super',
    videos: urls.map((url) => ({ url })),
    images: [],
  };
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_LUNA_COOKIE;
});

describe('resolveLunaWatchPage', () => {
  it('scans the luna watch page and labels luna formats', async () => {
    let seen = '';
    const out = await resolveLunaWatchPage('tv', '62715', 'Dragon Ball Super', (url) => {
      seen = url;
      return Promise.resolve(
        scanOf(['https://cdn.example.com/hls/x/index.m3u8?token=1'])
      );
    });
    expect(seen).toBe('https://watchluna.gd/watch/tv/62715/1/1');
    expect(out?.formats.map((format) => format.formatId)).toEqual(['luna-hls-0']);
    expect(out?.headers['Referer']).toBe(seen);
  });

  it('builds movie urls', async () => {
    let seen = '';
    await resolveLunaWatchPage('movie', '550', 'Fight Club', (url) => {
      seen = url;
      return Promise.resolve(scanOf([]));
    });
    expect(seen).toBe('https://watchluna.gd/watch/movie/550');
  });

  it('uses the pretty io url when a cookie is set', async () => {
    process.env.EXPO_PUBLIC_LUNA_COOKIE = 'cf_clearance=abc123';
    let seen = '';
    const out = await resolveLunaWatchPage('tv', '62715', 'Dragon Ball Super!', (url) => {
      seen = url;
      return Promise.resolve(scanOf(['https://cdn.example.com/v/x.mp4']));
    });
    expect(seen).toBe(
      'https://watchluna.io/tv/watch-dragon-ball-super-online-free-62715'
    );
    expect(out?.formats).toHaveLength(1);
  });

  it('returns null when the scan finds nothing', async () => {
    const out = await resolveLunaWatchPage('tv', '62715', 'Dragon Ball Super', () =>
      Promise.resolve(scanOf([]))
    );
    expect(out).toBeNull();
  });
});
