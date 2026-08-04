import { describe, it, expect, vi } from 'vitest';
import { createProxyFetch } from '../src/lib/extractors/youtube';

const PROXY = 'https://app.example.com';

function spyFetch() {
  const orig = globalThis.fetch;
  const spy = vi.fn().mockResolvedValue(new Response('ok'));
  globalThis.fetch = spy;
  return { orig, spy };
}

describe('createProxyFetch: shouldProxy routing', () => {
  it('proxies youtube.com and googlevideo.com', async () => {
    const { orig, spy } = spyFetch();
    const proxyFetch = createProxyFetch({ proxyBase: PROXY });
    try {
      await proxyFetch('https://www.youtube.com/watch?v=test', {});
      expect(spy).toHaveBeenCalledTimes(1);
      const called = spy.mock.calls[0][0] as string;
      expect(called).toMatch(/^\/proxy\?u=/);
      const decoded = decodeURIComponent(
        new URL(called, 'http://localhost').searchParams.get('u') ?? ''
      );
      expect(decoded).toBe('https://www.youtube.com/watch?v=test');

      await proxyFetch('https://rr1---sn-aigtjbaa.googlevideo.com/', {});
      const called2 = spy.mock.calls[1][0] as string;
      expect(called2).toMatch(/^\/proxy\?u=/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('calls original fetch for non-allowlisted hosts (no proxy prefix)', async () => {
    const { orig, spy } = spyFetch();
    const proxyFetch = createProxyFetch({ proxyBase: PROXY });
    try {
      await proxyFetch('https://api.song.link/v1-alpha/links', {});
      expect(spy).toHaveBeenCalledTimes(1);
      const called = spy.mock.calls[0][0] as string;
      expect(called).not.toMatch(/^\/proxy/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('sets YouTube Origin / Referer headers on proxied requests', async () => {
    const { orig, spy } = spyFetch();
    const proxyFetch = createProxyFetch({ proxyBase: PROXY });
    try {
      await proxyFetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const init = spy.mock.calls[0][1] as RequestInit;
      const headers = new Headers(init.headers as Record<string, string>);
      expect(headers.get('Origin')).toBe('https://www.youtube.com');
      expect(headers.get('Referer')).toBe('https://www.youtube.com/');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
