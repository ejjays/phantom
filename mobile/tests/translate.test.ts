import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseNumberedLines, translateLines } from '../src/lib/translate';

describe('parseNumberedLines', () => {
  it('matches lines by number', () => {
    expect(parseNumberedLines('1. Hello\n2. World', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('2. World\n1. Hello', 2)).toEqual(['Hello', 'World']);
  });

  it('matches flexible numbering formats', () => {
    expect(parseNumberedLines('**1.** Hello\n**2**. World', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('1: Hello\n2 - World', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('(1) Hello\n[2] World', 2)).toEqual(['Hello', 'World']);
  });

  it('salvages dropped lines with fallback', () => {
    expect(parseNumberedLines('1. Hello\n3. Bye', 3, ['orig1', 'grunt', 'orig3'])).toEqual([
      'Hello',
      'grunt',
      'Bye',
    ]);
  });

  it('rejects merges, drops, and junk when no fallback is provided', () => {
    expect(parseNumberedLines('1. Hello', 2)).toBeNull();
    expect(parseNumberedLines('1. Hello\n1. Again', 2)).toBeNull();
    expect(parseNumberedLines('no numbers here', 1)).toBeNull();
    expect(parseNumberedLines('', 0)).toEqual([]);
  });

  it('matches plain unnumbered lines when count > 1', () => {
    expect(parseNumberedLines('Hello\nWorld', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('- Hello\n- World', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('"Hello"\n\'World\'', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('```\nHello\nWorld\n```', 2)).toEqual(['Hello', 'World']);
  });
});

describe('translateLines', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns translated lines on exact match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            choices: [{ message: { content: '1. Hello\n2. World' } }],
          })
        )
      )
    );
    await expect(translateLines(['a', 'b'], 'ko', 'en', 'key')).resolves.toEqual([
      'Hello',
      'World',
    ]);
  });

  it('returns null on mismatch or http error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ choices: [{ message: { content: '1. Only' } }] })
        )
      )
    );
    await expect(translateLines(['a', 'b'], 'ko', 'en', 'key')).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('limited', { status: 429, headers: { 'retry-after': '0.01' } }))
      )
    );
    await expect(translateLines(['a'], 'ko', 'en', 'key')).resolves.toBeNull();
    await expect(translateLines([], 'ko', 'en', 'key')).resolves.toEqual([]);
  });

  it('retries rate limits then succeeds', async () => {
    const limited = () =>
      Promise.resolve(new Response('limited', { status: 429, headers: { 'retry-after': '0.01' } }));
    const ok = () =>
      Promise.resolve(Response.json({ choices: [{ message: { content: '1. Hi' } }] }));
    const fetch = vi.fn().mockImplementationOnce(limited).mockImplementationOnce(ok);
    vi.stubGlobal('fetch', fetch);
    await expect(translateLines(['x'], 'ko', 'en', 'key')).resolves.toEqual(['Hi']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('routes csk- key to Cerebras endpoint and falls back on error', async () => {
    const urls: string[] = [];
    const models: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        urls.push(url);
        const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        if (body.model) models.push(body.model);
        if (url.includes('cerebras')) {
          return Promise.resolve(new Response('rate limited', { status: 429, headers: { 'retry-after': '70' } }));
        }
        return Promise.resolve(Response.json({ choices: [{ message: { content: '1. Fallback' } }] }));
      })
    );
    const res = await translateLines(['input'], 'ko', 'en', 'csk-test', 'gsk-test');
    expect(res).toEqual(['Fallback']);
    expect(urls[0]).toContain('api.cerebras.ai');
    expect(models[0]).toBe('qwen-3.8-27b');
    expect(urls[1]).toContain('api.groq.com');
    expect(models[1]).toBe('qwen/qwen3.8-27b');
  });

  it('rotates across pool keys and switches on 429', async () => {
    const authHeaders: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const auth = headers?.Authorization ?? '';
        authHeaders.push(auth);
        if (auth === 'Bearer key-a') {
          return Promise.resolve(new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } }));
        }
        return Promise.resolve(Response.json({ choices: [{ message: { content: '1. Hello' } }] }));
      })
    );
    const res = await translateLines(['line1'], 'ko', 'en', ['key-a', 'key-b']);
    expect(res).toEqual(['Hello']);
    expect(authHeaders).toEqual(['Bearer key-a', 'Bearer key-b']);
  });

  it('falls back from pool to fallback keys when all pool keys fail', async () => {
    const authHeaders: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const auth = headers?.Authorization ?? '';
        authHeaders.push(auth);
        if (auth.startsWith('Bearer pool-')) {
          return Promise.resolve(new Response('server error', { status: 500 }));
        }
        return Promise.resolve(Response.json({ choices: [{ message: { content: '1. Rescued' } }] }));
      })
    );
    const res = await translateLines(['test'], 'ko', 'en', ['pool-1', 'pool-2'], 'csk-fallback');
    expect(res).toEqual(['Rescued']);
    expect(authHeaders).toEqual(['Bearer pool-1', 'Bearer pool-2', 'Bearer csk-fallback']);
  });
});
