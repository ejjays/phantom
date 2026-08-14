import { File, FileMode, Paths } from 'expo-file-system';
import { withRetry } from '../retry';
import { orderedParallelToFile } from './hls';
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
  try {
    const remaining = Math.ceil(total / CHUNK) - resumeChunk;
    await orderedParallelToFile(
      remaining,
      (idx) => {
        const global = resumeChunk + idx;
        const start = global * CHUNK;
        const end = Math.min(start + CHUNK, total) - 1;
        return withRetry(
          async () => {
            const res = await fetch(url, {
              headers: { ...headers, Range: `bytes=${start}-${end}` },
              signal,
            });
            if (res.status >= 400)
              throw new Error(`chunked: HTTP ${res.status}`);
            return new Uint8Array(await res.arrayBuffer());
          },
          { retries: 3, delayMs: 1500, signal }
        );
      },
      handle,
      CONCURRENCY,
      (done) =>
        onProgress(
          Math.min((resumeChunk + done) * CHUNK, total),
          total
        )
    );
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