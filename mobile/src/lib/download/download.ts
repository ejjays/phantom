import { File, FileMode, Paths } from 'expo-file-system';
import { withRetry } from '../retry';
import { orderedParallelToFile } from './hls';
import { nativeDownload } from './nativeDownload';
import { log } from '../log';

// largeHeap covers webview + parallel chunks
const CHUNK = 4_000_000;
const CONCURRENCY = 4;

type ResumeState = {
  url: string;
  total: number;
  chunk: number;
};

// sidecar next to the temp file; only a fingerprint, the byte
// count itself is the file size (in-order writes = contiguous prefix)
const statePath = (file: File): File =>
  new File(Paths.cache, `${file.name}.state`);

async function readState(file: File): Promise<ResumeState | null> {
  const stateFile = statePath(file);
  if (!stateFile.exists) return null;
  try {
    return JSON.parse(await stateFile.text()) as ResumeState;
  } catch {
    return null;
  }
}

const writeState = (file: File, state: ResumeState): void =>
  void statePath(file).write(JSON.stringify(state));

const clearState = (file: File): void => {
  const stateFile = statePath(file);
  if (stateFile.exists) stateFile.delete();
};

export async function chunkedDownload(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  // primary path: native streaming; the js chunked path below stays as
  // fallback for tests/older builds. unknown-size server or a js-side
  // native failure both land in the fallback.
  try {
    await nativeDownload(url, headers, file, onProgress, signal);
    return;
  } catch (error) {
    if (error instanceof Error && /chunked: HTTP/u.test(error.message)) {
      // cdn rejected the request; fall through to the js path so the
      // caller's 403 -> refreshStreamUrl hook still fires
      throw error;
    }
    // anything else (io, module missing in tests) retries in js below
  }

  const head = await fetch(url, {
    headers: { ...headers, Range: 'bytes=0-0' },
    signal,
  });
  await head.arrayBuffer();

  let total = 0;
  const range = head.headers.get('content-range');
  const match = range ? /\/(\d+)\s*$/u.exec(range) : null;
  if (match) total = parseInt(match[1], 10);
  if (!total) {
    const len = head.headers.get('content-length');
    total = len ? parseInt(len, 10) : 0;
  }
  if (total <= 0) throw new Error('chunked: unknown size');

  const prev = await readState(file);
  const canResume =
    !!prev &&
    prev.url === url &&
    prev.total === total &&
    prev.chunk === CHUNK &&
    file.exists;

  if (!canResume) {
    if (file.exists) file.delete();
    file.create();
    clearState(file);
  }

  // fingerprint first, so a process kill still leaves a resume point
  writeState(file, { url, total, chunk: CHUNK });

  const resumeBytes =
    canResume && file.size > 0 ? Math.min(file.size, total) : 0;
  const resumeChunk = Math.floor(resumeBytes / CHUNK);

  const handle = file.open(FileMode.ReadWrite);
  handle.offset = resumeChunk * CHUNK;
  const started = Date.now();
  let finished = false;

  // CDNs (googlevideo, spotifycdn) 403 bursts of parallel ranges on one
  // signed URL — retry those chunks sequentially before giving up
  const fetchChunk = (start: number, end: number): Promise<Uint8Array> =>
    withRetry(
      async () => {
        const res = await fetch(url, {
          headers: { ...headers, Range: `bytes=${start}-${end}` },
          signal,
        });
        if (res.status >= 400) throw new Error(`chunked: HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      { retries: 3, delayMs: 1500, signal }
    );

  try {
    const remaining = Math.ceil(total / CHUNK) - resumeChunk;
    let doneChunks = 0;
    try {
      await orderedParallelToFile(
        remaining,
        (idx) => {
          const global = resumeChunk + idx;
          const start = global * CHUNK;
          const end = Math.min(start + CHUNK, total) - 1;
          return fetchChunk(start, end);
        },
        handle,
        CONCURRENCY,
        (done) => {
          doneChunks = done;
          onProgress(
            Math.min((resumeChunk + done) * CHUNK, total),
            total
          );
        }
      );
    } catch {
      // parallel burst rejected → sequential ranges for the remainder
      for (let idx = doneChunks; idx < remaining; idx += 1) {
        const global = resumeChunk + idx;
        const start = global * CHUNK;
        const end = Math.min(start + CHUNK, total) - 1;
        const buf = await fetchChunk(start, end);
        handle.offset = start;
        handle.writeBytes(buf);
        doneChunks += 1;
        onProgress(
          Math.min((resumeChunk + doneChunks) * CHUNK, total),
          total
        );
      }
    }
    const secs = (Date.now() - started) / 1000;
    const mbps = secs > 0 ? ((total * 8) / 1e6 / secs).toFixed(1) : '0';
    log(
      'download',
      `[chunked] ${(total / 1e6).toFixed(1)}MB${resumeBytes > 0 ? ' (resumed)' : ''} in ${secs.toFixed(1)}s = ${mbps} Mbps`
    );
    finished = true;
  } finally {
    handle.close();
    // keep sidecar on failure so a retry can resume mid-file;
    // cancel/success leave nothing behind
    if (finished || signal?.aborted) clearState(file);
  }
}