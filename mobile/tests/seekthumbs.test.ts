import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import {
  fetchBytesCapped,
  fetchThumbSegments,
  parseThumbSegments,
  segmentIndexAt,
} from '../src/lib/seekThumbs';

const mockFetch = vi.mocked(gatedFetch);

function textRes(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) } as unknown as Response;
}

function bytesRes(bytes: Uint8Array, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as unknown as Response;
}

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXTINF:6.0,',
  'seg-1.ts',
  '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:06Z',
  '#EXTINF:6.0,',
  'https://cdn.example/seg-2.ts',
  '#EXTINF:4.5,',
  'seg-3.ts',
].join('\n');

describe('parseThumbSegments', () => {
  it('pairs durations with resolved segment urls', () => {
    const segs = parseThumbSegments(MEDIA, 'https://cdn.example/hls/playlist.m3u8');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ uri: 'https://cdn.example/hls/seg-1.ts', duration: 6 });
    expect(segs[1].uri).toBe('https://cdn.example/seg-2.ts');
    expect(segs[2].duration).toBe(4.5);
  });

  it('ignores segments without a duration', () => {
    const segs = parseThumbSegments('#EXTM3U\nlonely.ts\n', 'https://cdn.example/x.m3u8');
    expect(segs).toHaveLength(0);
  });
});

describe('segmentIndexAt', () => {
  const segs = [
    { uri: 'a', duration: 6 },
    { uri: 'b', duration: 6 },
    { uri: 'c', duration: 4.5 },
  ];

  it.each([
    [0, 0],
    [5.9, 0],
    [6, 1],
    [12, 2],
    [999, 2],
  ])('maps %ss to segment %s', (time, index) => {
    expect(segmentIndexAt(segs, time)).toBe(index);
  });

  it('returns -1 when empty', () => {
    expect(segmentIndexAt([], 3)).toBe(-1);
  });
});

describe('fetchThumbSegments', () => {
  beforeEach(() => mockFetch.mockReset());

  it('rejects master playlists', async () => {
    mockFetch.mockResolvedValue(
      textRes('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n')
    );
    await expect(fetchThumbSegments('https://cdn.example/m.m3u8', {})).resolves.toBeNull();
  });

  it('fetches and caches media playlists', async () => {
    mockFetch.mockResolvedValue(textRes(MEDIA));
    const first = await fetchThumbSegments('https://cdn.example/hls/p.m3u8', {});
    expect(first).toHaveLength(3);
    const second = await fetchThumbSegments('https://cdn.example/hls/p.m3u8', {});
    expect(second).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchBytesCapped', () => {
  beforeEach(() => mockFetch.mockReset());

  it('caps large responses', async () => {
    mockFetch.mockResolvedValue(bytesRes(new Uint8Array(10)));
    const bytes = await fetchBytesCapped('https://cdn.example/s.ts', {}, 4);
    expect(bytes?.length).toBe(4);
  });

  it('returns null on http error', async () => {
    mockFetch.mockResolvedValue(bytesRes(new Uint8Array(4), false));
    await expect(fetchBytesCapped('https://cdn.example/s.ts', {})).resolves.toBeNull();
  });
});
