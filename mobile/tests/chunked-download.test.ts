import { describe, it, expect, vi } from 'vitest';

type FakeState = { exists: boolean; content: string };

const stateFiles = new Map<string, FakeState>();

vi.mock('expo-file-system', () => ({
  File: class {
    exists: boolean;
    size: number;
    name: string;
    private state: FakeState | undefined;
    constructor(_dir: string, name?: string) {
      this.size = 0;
      this.name = name ?? 'unknown';
      this.exists = stateFiles.has(this.name);
      this.state = stateFiles.get(this.name);
    }
    delete() {
      this.exists = false;
      this.state = undefined;
      stateFiles.delete(this.name);
    }
    create() {
      this.exists = true;
    }
    write(content: string) {
      this.exists = true;
      stateFiles.set(this.name, { exists: true, content });
    }
    text(): Promise<string> {
      return Promise.resolve(this.state?.content ?? '');
    }
    open() {
      return { offset: 0, writeBytes: vi.fn(), close: vi.fn() };
    }
  },
  FileMode: { ReadWrite: 'ReadWrite' },
  Paths: { cache: 'file:///cache' },
}));
vi.mock('../src/lib/retry', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { chunkedDownload } from '../src/lib/download/download';

const CHUNK = 4_000_000; // mirrors download.ts

function makeFileMock(exists: boolean, size = 0) {
  const handle = { offset: 0, writeBytes: vi.fn(), close: vi.fn() };
  return {
    name: 'target.vid.mp4',
    exists,
    size,
    delete: vi.fn(),
    create: vi.fn(),
    open: vi.fn(() => handle),
    handle,
  };
}

function makeFetchMock(total: number, ranges: string[]) {
  return vi.fn(
    (
      _url: string,
      init?: { headers?: Record<string, string> }
    ): Promise<{
      ok: boolean;
      status: number;
      headers?: { get: (k: string) => string | null };
      arrayBuffer: () => Promise<ArrayBuffer>;
    }> => {
      const range = init?.headers?.Range ?? '';
      if (range === 'bytes=0-0') {
        return Promise.resolve({
          ok: true,
          status: 206,
          headers: {
            get: (k: string) =>
              k.toLowerCase() === 'content-range' ? `bytes 0-0/${total}` : null,
          },
          arrayBuffer: () =>
            Promise.resolve(new Uint8Array(1).buffer as ArrayBuffer),
        });
      }
      ranges.push(range);
      const start = Number(/bytes=(\d+)-/u.exec(range)?.[1] ?? 0);
      const idx = start / CHUNK;
      return new Promise((res) =>
        setTimeout(
          () =>
            res({
              ok: true,
              status: 206,
              arrayBuffer: () =>
                Promise.resolve(
                  new Uint8Array([idx % 256]).buffer as ArrayBuffer
                ),
            }),
          (4 - idx) * 5
        )
      );
    }
  );
}

describe('chunkedDownload', () => {
  it('fetches ranges in parallel and writes them in order', async () => {
    const total = CHUNK * 3 + 100; // 4 chunks: 3 full + tail
    const ranges: string[] = [];
    global.fetch = makeFetchMock(total, ranges) as unknown as typeof fetch;

    // leftover temp from an aborted run, but no sidecar -> wipe & restart
    const file = makeFileMock(true, CHUNK);

    await chunkedDownload(
      'https://gv.example/videoplayback',
      {},
      file as never,
      () => {}
    );

    expect(file.open().writeBytes).toHaveBeenCalledTimes(4);
    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toBe(`bytes=0-${CHUNK - 1}`);
    expect(file.delete).toHaveBeenCalled();
    expect(file.create).toHaveBeenCalled();
  });

  it('resumes from partial file when state matches', async () => {
    const total = CHUNK * 4; // 4 chunks
    const ranges: string[] = [];
    global.fetch = makeFetchMock(total, ranges) as unknown as typeof fetch;

    const file = makeFileMock(true, CHUNK * 2);

    stateFiles.set(`${file.name}.state`, {
      exists: true,
      content: JSON.stringify({
        url: 'https://g.example/videoplayback',
        total,
        chunk: CHUNK,
      }),
    });

    await chunkedDownload(
      'https://g.example/videoplayback',
      {},
      file as never,
      () => {}
    );

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBe(`bytes=${CHUNK * 2}-${CHUNK * 3 - 1}`);
    expect(file.delete).not.toHaveBeenCalled();
    expect(file.create).not.toHaveBeenCalled();
    // handle must be positioned at the resume offset, not the start
    expect(file.open().offset).toBe(CHUNK * 2);
    expect(file.open().writeBytes).toHaveBeenCalledTimes(2);
    stateFiles.delete(`${file.name}.state`);
  });

  it('restarts fresh when url changed', async () => {
    const ranges: string[] = [];
    global.fetch = makeFetchMock(CHUNK * 4, ranges) as unknown as typeof fetch;
    const file = makeFileMock(true, CHUNK * 2);
    stateFiles.set(`${file.name}.state`, {
      exists: true,
      content: JSON.stringify({
        url: 'https://old.example/videoplayback',
        total: CHUNK * 4,
        chunk: CHUNK,
      }),
    });

    await chunkedDownload(
      'https://g.example/videoplayback',
      {},
      file as never,
      () => {}
    );

    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toBe(`bytes=0-${CHUNK - 1}`);
    expect(file.delete).toHaveBeenCalled();
    expect(file.create).toHaveBeenCalled();
    stateFiles.delete(`${file.name}.state`);
  });

  it('keeps sidecar on failure so a retry can resume mid-file', async () => {
    const file = makeFileMock(true, CHUNK);
    stateFiles.set(`${file.name}.state`, {
      exists: true,
      content: JSON.stringify({
        url: 'https://g.example/videoplayback',
        total: CHUNK * 4,
        chunk: CHUNK,
      }),
    });
    const fail = vi.fn(
      (
        _url: string,
        init?: { headers?: Record<string, string> }
      ): Promise<{
        ok: boolean;
        status: number;
        headers?: { get: (k: string) => string | null };
        arrayBuffer: () => Promise<ArrayBuffer>;
      }> => {
        const range = init?.headers?.Range ?? '';
        if (range === 'bytes=0-0') {
          return Promise.resolve({
            ok: true,
            status: 206,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-range'
                  ? `bytes 0-0/${CHUNK * 4}`
                  : null,
            },
            arrayBuffer: () =>
              Promise.resolve(new Uint8Array(1).buffer as ArrayBuffer),
          });
        }
        return Promise.reject(new Error('network dropped'));
      }
    );
    global.fetch = fail as unknown as typeof fetch;

    await expect(
      chunkedDownload(
        'https://g.example/videoplayback',
        {},
        file as never,
        () => {}
      )
    ).rejects.toThrow('network dropped');

    expect(file.delete).not.toHaveBeenCalled();
    expect(stateFiles.has(`${file.name}.state`)).toBe(true);
    stateFiles.delete(`${file.name}.state`);
  });

  it('clears sidecar once the download finishes', async () => {
    const total = CHUNK * 4;
    const ranges: string[] = [];
    global.fetch = makeFetchMock(total, ranges) as unknown as typeof fetch;
    const file = makeFileMock(true, CHUNK * 2);
    stateFiles.set(`${file.name}.state`, {
      exists: true,
      content: JSON.stringify({
        url: 'https://g.example/videoplayback',
        total,
        chunk: CHUNK,
      }),
    });

    await chunkedDownload(
      'https://g.example/videoplayback',
      {},
      file as never,
      () => {}
    );

    expect(stateFiles.has(`${file.name}.state`)).toBe(false);
  });
});
