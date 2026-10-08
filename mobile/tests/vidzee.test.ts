import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../src/lib/net';
import {
  vidzeeStreamUrl,
  vidzeeHeaders,
  fetchVidzeeFormats,
} from '../src/extractors/movies/vidzee';

const mockedFetch = vi.mocked(fetchWithTimeout);

function okOnce(payload: unknown) {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function failOnce() {
  mockedFetch.mockRejectedValueOnce(new Error('timeout'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vidzeeStreamUrl', () => {
  it('builds movie urls', () => {
    expect(vidzeeStreamUrl({ kind: 'movie', tmdbId: '550' }, 'dcloud')).toBe(
      'https://core.vidzee.wtf/streams/movie/550?s=dcloud&e=0'
    );
  });

  it('builds tv urls with season and episode', () => {
    expect(
      vidzeeStreamUrl({ kind: 'tv', tmdbId: '62715', season: '2', episode: '5' }, 'tik')
    ).toBe('https://core.vidzee.wtf/streams/tv/62715/2/5?s=tik&e=0');
  });
});

describe('vidzeeHeaders', () => {
  it('points at the player origin', () => {
    const headers = vidzeeHeaders();
    expect(headers['Referer']).toBe('https://player.vidzee.wtf/');
    expect(headers['Origin']).toBe('https://player.vidzee.wtf');
  });
});

describe('fetchVidzeeFormats', () => {
  it('collects one auto rung per answering server', async () => {
    okOnce({ url: 'https://cdn2.x/hls/a/index.m3u8', language: 'Auto', headers: {} });
    okOnce({ url: 'https://cdn.x/hls/b/index.m3u8', language: 'Auto', headers: {} });
    failOnce();
    const out = await fetchVidzeeFormats({
      kind: 'tv',
      tmdbId: '127532',
      season: '1',
      episode: '1',
    });
    expect(out?.formats.map((format) => format.formatId)).toEqual([
      'vidzee-dcloud-auto',
      'vidzee-tik-auto',
    ]);
    expect(out?.formats[0].isHls).toBe(true);
    expect(out?.formats[0].quality).toBe('Auto');
    expect(out?.headers['Referer']).toBe('https://player.vidzee.wtf/');
  });

  it('dedupes identical urls across servers', async () => {
    const same = { url: 'https://cdn.x/hls/a/index.m3u8', language: 'Auto', headers: {} };
    okOnce(same);
    okOnce(same);
    okOnce(same);
    const out = await fetchVidzeeFormats({ kind: 'movie', tmdbId: '550' });
    expect(out?.formats).toHaveLength(1);
  });

  it('skips encrypted blobs and errors', async () => {
    okOnce(JSON.parse('{"c":"aGVsbG8="}'));
    failOnce();
    failOnce();
    const out = await fetchVidzeeFormats({ kind: 'movie', tmdbId: '550' });
    expect(out).toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });
});
