import { describe, it, expect, vi } from 'vitest';
import { proxyFetch } from '../src/lib/net';

function spyFetch() {
  const orig = globalThis.fetch;
  const spy = vi.fn().mockResolvedValue(new Response('ok'));
  globalThis.fetch = spy;
  return { orig, spy };
}

function proxiedPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

describe('proxyFetch: subdomain routing', () => {
  it('proxies subdomains of allowlisted base domains', async () => {
    const { orig, spy } = spyFetch();
    try {
      await proxyFetch('https://pbs.twimg.com/media/foo.jpg', {});
      await proxyFetch('https://scontent.cdninstagram.com/v/t51.jpg', {});
      await proxyFetch('https://rr1---sn-aigtjbaa.googlevideo.com/videoplayback', {});
      await proxyFetch('https://music.youtube.com/watch?v=test', {});

      expect(spy).toHaveBeenCalledTimes(4);
      for (const call of spy.mock.calls) {
        const called = String(call[0]);
        expect(called).toMatch(/\/proxy\?u=/);
      }

      const decoded = decodeURIComponent(
        new URL(String(spy.mock.calls[0][0])).searchParams.get('u') ?? ''
      );
      expect(decoded).toBe('https://pbs.twimg.com/media/foo.jpg');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('leaves non-allowlisted hosts direct', async () => {
    const { orig, spy } = spyFetch();
    try {
      await proxyFetch('https://example.com/api', {});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toBe('https://example.com/api');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('keeps exact matches proxied and strips nothing from the URL', async () => {
    const { orig, spy } = spyFetch();
    try {
      await proxyFetch('https://video.twimg.com/ext_tw_video/1.mp4', {});
      const called = proxiedPath(String(spy.mock.calls[0][0]));
      const decoded = decodeURIComponent(
        new URL(called, 'http://localhost').searchParams.get('u') ?? ''
      );
      expect(decoded).toBe('https://video.twimg.com/ext_tw_video/1.mp4');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
