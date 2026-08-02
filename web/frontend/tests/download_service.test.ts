import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/lib/opfs', () => ({
  OPFSStorage: { init: vi.fn() },
}));

import {
  DownloadService,
  type DownloadUpdate,
} from '../src/lib/download.service';
import { OPFSStorage } from '../src/lib/opfs';

function makeReader(chunks: Uint8Array[]) {
  let idx = 0;
  return {
    read: () =>
      idx < chunks.length
        ? Promise.resolve({ done: false, value: chunks[idx++] })
        : Promise.resolve({ done: true, value: undefined }),
  };
}

function mockResponse(opts: {
  ok: boolean;
  status?: number;
  chunks?: Uint8Array[];
  contentLength?: string | null;
}) {
  return {
    ok: opts.ok,
    status: opts.status ?? 200,
    body: opts.ok ? { getReader: () => makeReader(opts.chunks ?? []) } : null,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length'
          ? (opts.contentLength ?? null)
          : null,
    },
  };
}

function fakeStorage() {
  const writes: Uint8Array[] = [];
  const file = new File(['data'], 'out.mp4');
  const storage = {
    write: vi.fn((chunk: Uint8Array) => {
      writes.push(chunk);
      return Promise.resolve();
    }),
    getFile: vi.fn(() => Promise.resolve(file)),
    close: vi.fn(() => Promise.resolve()),
  };
  return { storage, writes, file };
}

describe('DownloadService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('emits connecting then progress then complete with the file', async () => {
    const { storage, writes, file } = fakeStorage();
    vi.mocked(OPFSStorage.init).mockResolvedValue(
      storage as unknown as OPFSStorage
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          mockResponse({
            ok: true,
            chunks: [new Uint8Array(5), new Uint8Array(5)],
            contentLength: '10',
          })
        )
      )
    );

    const updates: DownloadUpdate[] = [];
    const svc = new DownloadService((update) => updates.push(update));
    await svc.start('http://example/file', 'out.mp4');

    expect(updates[0]).toEqual({ status: 'connecting', progress: 0 });
    expect(updates).toContainEqual({ status: 'downloading', progress: 50 });
    expect(updates).toContainEqual({ status: 'downloading', progress: 100 });
    expect(writes).toHaveLength(2);

    const done = updates.find((update) => update.status === 'complete');
    expect(done).toBeDefined();
    if (done?.status === 'complete') {
      expect(done.progress).toBe(100);
      expect(done.file).toBe(file);
    }
  });

  it('emits an error update on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mockResponse({ ok: false, status: 500 })))
    );

    const updates: DownloadUpdate[] = [];
    const svc = new DownloadService((update) => updates.push(update));
    await svc.start('http://example/file', 'out.mp4');

    expect(updates.some((update) => update.status === 'error')).toBe(true);
    expect(vi.mocked(OPFSStorage.init)).not.toHaveBeenCalled();
  });

  it('completes without progress events when content-length is absent', async () => {
    const { storage } = fakeStorage();
    vi.mocked(OPFSStorage.init).mockResolvedValue(
      storage as unknown as OPFSStorage
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          mockResponse({
            ok: true,
            chunks: [new Uint8Array(8)],
            contentLength: null,
          })
        )
      )
    );

    const updates: DownloadUpdate[] = [];
    const svc = new DownloadService((update) => updates.push(update));
    await svc.start('http://example/file', 'out.mp4');

    expect(updates.some((update) => update.status === 'downloading')).toBe(
      false
    );
    expect(updates[updates.length - 1].status).toBe('complete');
  });
});
