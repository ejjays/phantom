import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseNumberedLines, translateLines } from '../src/lib/translate';

describe('parseNumberedLines', () => {
  it('matches lines by number', () => {
    expect(parseNumberedLines('1. Hello\n2. World', 2)).toEqual(['Hello', 'World']);
    expect(parseNumberedLines('2. World\n1. Hello', 2)).toEqual(['Hello', 'World']);
  });

  it('rejects merges, drops, and junk', () => {
    expect(parseNumberedLines('1. Hello', 2)).toBeNull();
    expect(parseNumberedLines('1. Hello\n1. Again', 2)).toBeNull();
    expect(parseNumberedLines('no numbers here', 1)).toBeNull();
    expect(parseNumberedLines('', 0)).toEqual([]);
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
    await expect(translateLines(['a', 'b'], 'ko', 'key')).resolves.toEqual([
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
    await expect(translateLines(['a', 'b'], 'ko', 'key')).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('limited', { status: 429, headers: { 'retry-after': '0.01' } }))
      )
    );
    await expect(translateLines(['a'], 'ko', 'key')).resolves.toBeNull();
    await expect(translateLines([], 'ko', 'key')).resolves.toEqual([]);
  });

  it('retries rate limits then succeeds', async () => {
    const limited = () =>
      Promise.resolve(new Response('limited', { status: 429, headers: { 'retry-after': '0.01' } }));
    const ok = () =>
      Promise.resolve(Response.json({ choices: [{ message: { content: '1. Hi' } }] }));
    const fetch = vi.fn().mockImplementationOnce(limited).mockImplementationOnce(ok);
    vi.stubGlobal('fetch', fetch);
    await expect(translateLines(['x'], 'ko', 'key')).resolves.toEqual(['Hi']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
