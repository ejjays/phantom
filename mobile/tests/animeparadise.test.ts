import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../src/lib/net';
import { fetchParadiseFormats } from '../src/extractors/movies/animeparadise';

const mockedFetch = vi.mocked(fetchWithTimeout);

beforeEach(() => {
  vi.clearAllMocks();
});

function okOnce(payload: unknown) {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(''),
  } as Response);
}

const MASTER =
  '#EXTM3U\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=1620966,RESOLUTION=1920x1080,FRAME-RATE=23.974,CODECS="avc1.640032,mp4a.40.2"\n' +
  '/m3u8?url=hi\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,FRAME-RATE=23.974,CODECS="avc1.64001f,mp4a.40.2"\n' +
  '/m3u8?url=lo\n';

function okMasterOnce() {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(MASTER),
  } as Response);
}

describe('fetchParadiseFormats', () => {
  it('resolves variants through search, episodes and stream link', async () => {
    okOnce({
      data: [{ _id: 'aMMQZ1PgTLwWeSjR', title: 'Dragon Ball Super', link: 'dragon-ball-super' }],
    });
    okOnce({ data: { type: 'TV' } });
    okOnce({ data: [{ uid: 'ep-uid-1', number: '1' }] });
    okOnce({ data: { episode: { streamLink: 'tok123' } } });
    okMasterOnce();
    const out = await fetchParadiseFormats(
      { kind: 'tv', tmdbId: '62715', season: '1', episode: '1' },
      'Dragon Ball Super'
    );
    expect(out?.formats.map((format) => format.formatId)).toEqual([
      'paradise-auto',
      'paradise-1080p',
      'paradise-720p',
    ]);
    expect(out?.formats[0].isHls).toBe(true);
    expect(out?.headers['Referer']).toBe('https://animeparadise.moe/');
    expect(mockedFetch).toHaveBeenCalledTimes(5);
  });

  it('skips non-tv titles without fetching', async () => {
    const out = await fetchParadiseFormats({ kind: 'movie', tmdbId: '550' }, 'Fight Club');
    expect(out).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('skips past season one without fetching', async () => {
    const out = await fetchParadiseFormats(
      { kind: 'tv', tmdbId: '62715', season: '2', episode: '1' },
      'Dragon Ball Super'
    );
    expect(out).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns null when no title matches', async () => {
    okOnce({ data: [{ _id: 'x', title: 'Dragon Ball Super: Broly', link: 'dragon-ball-super-broly' }] });
    const out = await fetchParadiseFormats(
      { kind: 'tv', tmdbId: '62715', season: '1', episode: '1' },
      'Dragon Ball Super'
    );
    expect(out).toBeNull();
  });

  it('returns null when the manifest is dead', async () => {
    okOnce({
      data: [{ _id: 'aMMQZ1PgTLwWeSjR', title: 'Dragon Ball Super', link: 'dragon-ball-super' }],
    });
    okOnce({ data: { type: 'TV' } });
    okOnce({ data: [{ uid: 'ep-uid-1', number: '1' }] });
    okOnce({ data: { episode: { streamLink: 'tok123' } } });
    mockedFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('') } as Response);
    const out = await fetchParadiseFormats(
      { kind: 'tv', tmdbId: '62715', season: '1', episode: '1' },
      'Dragon Ball Super'
    );
    expect(out).toBeNull();
  });
});
