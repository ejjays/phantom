import { describe, it, expect, vi } from 'vitest';

vi.mock('expo-file-system', () => ({
  File: class {},
  FileMode: { WriteOnly: 'writeonly' },
}));
vi.mock('../src/lib/retry', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import {
  parseMediaPlaylist,
  downloadPlaylistToFile,
} from '../src/lib/download/hls';

describe('parseMediaPlaylist', () => {
  const BASE =
    'https://cdn.vimeocdn.com/exp/range/v2/playlist/avf/abc/video.m3u8';

  it('returns init first, then media segments, resolved absolute', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-MAP:URI="../../init/d.mp4?range=0-695"',
      '#EXTINF:6.04,',
      '../../seg/0.mp4?range=1988-834965',
      '#EXTINF:6.04,',
      '../../seg/1.mp4?range=834966-1441645',
    ].join('\n');
    const urls = parseMediaPlaylist(text, BASE);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toMatch(/^https:\/\//u);
    expect(urls[0]).toContain('/init/d.mp4?range=0-695');
    expect(urls[1]).toContain('/seg/0.mp4?range=1988-834965');
    expect(urls[2]).toContain('/seg/1.mp4?range=834966-1441645');
  });

  it('handles playlists without an init map', () => {
    const text = ['#EXTM3U', '#EXTINF:4,', 'a.ts', '#EXTINF:4,', 'b.ts'].join(
      '\n'
    );
    expect(parseMediaPlaylist(text, 'https://cdn.example/hls/p.m3u8')).toEqual([
      'https://cdn.example/hls/a.ts',
      'https://cdn.example/hls/b.ts',
    ]);
  });

  it('ignores tags and blank lines', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '',
      '#EXTINF:6,',
      'x.m4s',
      '',
    ].join('\n');
    expect(parseMediaPlaylist(text, 'https://cdn.example/p.m3u8')).toEqual([
      'https://cdn.example/x.m4s',
    ]);
  });
});

describe('downloadPlaylistToFile', () => {
  it('writes segments in playlist order despite out-of-order completion', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:1,',
      's0.mp4',
      '#EXTINF:1,',
      's1.mp4',
      '#EXTINF:1,',
      's2.mp4',
    ].join('\n');
    const value: Record<string, number> = {
      'init.mp4': 9,
      's0.mp4': 0,
      's1.mp4': 1,
      's2.mp4': 2,
    };
    // s2 finishes first, init/s0 slowest -> exercises reordering
    const delay: Record<string, number> = {
      'init.mp4': 5,
      's0.mp4': 40,
      's1.mp4': 20,
      's2.mp4': 10,
    };

    const fetchMock = vi.fn(
      (
        input: string
      ): Promise<{
        ok: boolean;
        status: number;
        text?: () => Promise<string>;
        arrayBuffer?: () => Promise<ArrayBuffer>;
      }> => {
        if (input.includes('playlist.m3u8')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(playlist),
          });
        }
        const key = (input.split('/').pop() ?? '').split('?')[0];
        return new Promise((res) =>
          setTimeout(
            () =>
              res({
                ok: true,
                status: 200,
                arrayBuffer: () =>
                  Promise.resolve(
                    new Uint8Array([value[key]]).buffer as ArrayBuffer
                  ),
              }),
            delay[key]
          )
        );
      }
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const written: number[] = [];
    const handle = {
      writeBytes: (buf: Uint8Array) => written.push(buf[0]),
      close: vi.fn(),
    };
    const file = {
      exists: false,
      delete: vi.fn(),
      create: vi.fn(),
      open: () => handle,
    };

    const result = await downloadPlaylistToFile(
      'https://cdn.example/hls/playlist.m3u8',
      {},
      file as unknown as Parameters<typeof downloadPlaylistToFile>[2],
      () => {},
      4
    );
    expect(written).toEqual([9, 0, 1, 2]);
    expect(result.segments).toBe(4);
    expect(result.bytes).toBe(4);
  });

  it('rejects image-typed segments instead of baking placeholders in', async () => {
    const playlist = ['#EXTM3U', '#EXTINF:1,', 's0.ts'].join('\n');
    global.fetch = ((input: string) => {
      if (input.includes('playlist.m3u8')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(playlist),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: () =>
          Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer),
      });
    }) as unknown as typeof fetch;
    const file = {
      exists: false,
      delete: vi.fn(),
      create: vi.fn(),
      open: () => ({ writeBytes: vi.fn(), close: vi.fn() }),
    };
    await expect(
      downloadPlaylistToFile(
        'https://cdn.example/hls/playlist.m3u8',
        {},
        file as unknown as Parameters<typeof downloadPlaylistToFile>[2],
        () => {},
        4
      )
    ).rejects.toThrow(/expired link/iu);
  });

  it('rejects png magic bytes even without a content type', async () => {
    const playlist = ['#EXTM3U', '#EXTINF:1,', 's0.ts'].join('\n');
    global.fetch = ((input: string) => {
      if (input.includes('playlist.m3u8')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(playlist),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: () =>
          Promise.resolve(
            new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
              .buffer
          ),
      });
    }) as unknown as typeof fetch;
    const file = {
      exists: false,
      delete: vi.fn(),
      create: vi.fn(),
      open: () => ({ writeBytes: vi.fn(), close: vi.fn() }),
    };
    await expect(
      downloadPlaylistToFile(
        'https://cdn.example/hls/playlist.m3u8',
        {},
        file as unknown as Parameters<typeof downloadPlaylistToFile>[2],
        () => {},
        4
      )
    ).rejects.toThrow(/png/iu);
  });
});
