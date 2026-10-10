import { describe, it, expect, vi } from 'vitest';

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

describe('resolveLunaWatchPage', () => {
  it('scans the luna watch page and labels luna formats', async () => {
    let seen = '';
    const out = await resolveLunaWatchPage('tv', '62715', (url) => {
      seen = url;
      return Promise.resolve(
        scanOf(['https://cdn.example.com/hls/x/index.m3u8?token=1'])
      );
    });
    expect(seen).toBe('https://watchluna.gd/watch/tv/62715/1/1');
    expect(out?.formats.map((format) => format.formatId)).toEqual([
      'luna-hls-0',
    ]);
    expect(out?.headers['Referer']).toBe(seen);
  });

  it('builds movie urls', async () => {
    let seen = '';
    await resolveLunaWatchPage('movie', '550', (url) => {
      seen = url;
      return Promise.resolve(scanOf([]));
    });
    expect(seen).toBe('https://watchluna.gd/watch/movie/550');
  });

  it('returns null when the scan finds nothing', async () => {
    const out = await resolveLunaWatchPage('tv', '62715', () =>
      Promise.resolve(scanOf([]))
    );
    expect(out).toBeNull();
  });
});
