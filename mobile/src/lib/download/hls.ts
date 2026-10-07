import { File, FileMode } from 'expo-file-system';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { ABORT_MESSAGE, withRetry } from '../retry';

interface WriteHandle {
  writeBytes: (bytes: Uint8Array) => void;
}

// expired signed segment urls often return http 200 with a placeholder
// (image, error page) instead of an error — sniff every segment so a
// dead link fails loud instead of baking garbage into the output file
function assertVideoSegment(bytes: Uint8Array, contentType: string | null): void {
  if (contentType?.startsWith('image/')) {
    throw new Error(`segment content ${contentType} (expired link?)`);
  }
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      throw new Error('segment content png (expired link?)');
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      throw new Error('segment content jpeg (expired link?)');
    }
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      throw new Error('segment content gif (expired link?)');
    }
    if (
      bytes[0] === 0x3c &&
      (bytes[1] === 0x21 || bytes[1] === 0x68 || bytes[1] === 0x48)
    ) {
      throw new Error('segment content html (expired link?)');
    }
  }
}

// init (#EXT-X-MAP) + media segments, in playlist order
export function parseMediaPlaylist(text: string, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/URI="([^"]+)"/u)?.[1];
      if (uri) urls.push(new URL(uri, baseUrl).toString());
    } else if (line && !line.startsWith('#')) {
      urls.push(new URL(line, baseUrl).toString());
    }
  }
  return urls;
}

/**
 * items fetched concurrently, written in index order; peak memory
 * ~concurrency items (not whole file). returns total bytes written.
 */
export async function orderedParallelToFile(
  count: number,
  fetchItem: (index: number) => Promise<Uint8Array>,
  handle: WriteHandle,
  concurrency: number,
  onProgress: (done: number, total: number) => void
): Promise<number> {
  const ready = new Map<number, Uint8Array>();
  let nextWrite = 0;
  let nextFetch = 0;
  let inFlight = 0;
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const fail = (err: unknown): void => {
      if (failed) return;
      failed = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const pump = (): void => {
      if (failed) return;
      while (ready.has(nextWrite)) {
        const buf = ready.get(nextWrite);
        ready.delete(nextWrite);
        if (buf) {
          handle.writeBytes(buf);
          bytes += buf.byteLength;
        }
        nextWrite += 1;
        onProgress(nextWrite, count);
      }
      if (nextWrite >= count) {
        resolve();
        return;
      }
      // cap outstanding -> peak memory ~concurrency items
      while (
        inFlight < concurrency &&
        nextFetch < count &&
        nextFetch - nextWrite < concurrency
      ) {
        const idx = nextFetch;
        nextFetch += 1;
        inFlight += 1;
        fetchItem(idx)
          .then((buf) => {
            ready.set(idx, buf);
            inFlight -= 1;
            pump();
          })
          .catch(fail);
      }
    };
    pump();
  });
  return bytes;
}

export async function downloadPlaylistToFile(
  playlistUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (done: number, total: number) => void,
  concurrency = 4,
  signal?: AbortSignal
): Promise<{ segments: number; bytes: number }> {
  const res = await fetch(playlistUrl, { headers, signal });
  if (!res.ok) throw new Error(`playlist HTTP ${res.status}`);
  const urls = parseMediaPlaylist(await res.text(), playlistUrl);
  if (urls.length === 0) throw new Error('empty playlist');

  if (file.exists) file.delete();
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  try {
    const bytes = await orderedParallelToFile(
      urls.length,
      (idx) =>
        withRetry(
          async () => {
            const seg = await fetch(urls[idx], { headers, signal });
            if (seg.status >= 400) {
              throw new Error(`segment HTTP ${seg.status}`);
            }
            const bytes = new Uint8Array(await seg.arrayBuffer());
            assertVideoSegment(bytes, seg.headers?.get?.('content-type') ?? null);
            return bytes;
          },
          { retries: 2, delayMs: 400, signal }
        ),
      handle,
      concurrency,
      onProgress
    );
    return { segments: urls.length, bytes };
  } finally {
    handle.close();
  }
}

type Cancellable = { cancel?: () => void };

// native-stack segment pull: blob-util writes straight to disk, so large
// playlists never touch the js heap and stay invisible to devtools network
// inspection (whose per-event json ooms dev builds on big pulls)
export async function nativeSegmentsToFiles(
  urls: string[],
  headers: Record<string, string>,
  dests: string[],
  onProgress: (done: number, total: number) => void,
  concurrency: number,
  signal?: AbortSignal
): Promise<void> {
  const cancelTasks: Cancellable[] = [];
  const onAbort = (): void => {
    for (const task of cancelTasks) {
      try {
        task.cancel?.();
      } catch {
        /* already settled */
      }
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let next = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
      while (next < urls.length) {
        if (signal?.aborted) throw new Error(ABORT_MESSAGE);
        const idx = next;
        next += 1;
        await withRetry(
          async () => {
            // blob-util wants a raw fs path, not a file:// uri
            const raw = decodeURIComponent(dests[idx].replace(/^file:\/\//u, ''));
            const task = ReactNativeBlobUtil.config({ path: raw }).fetch(
              'GET',
              urls[idx],
              headers
            );
            cancelTasks.push(task);
            const res = await task;
            const info = res.info();
            if (info.status >= 400) throw new Error(`segment HTTP ${info.status}`);
            const contentType =
              info.headers['Content-Type'] ?? info.headers['content-type'] ?? null;
            if (typeof contentType === 'string' && contentType.startsWith('image/')) {
              throw new Error(`segment content ${contentType} (expired link?)`);
            }
          },
          { retries: 2, delayMs: 400, signal }
        );
        done += 1;
        onProgress(done, urls.length);
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, () =>
        worker()
      )
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
