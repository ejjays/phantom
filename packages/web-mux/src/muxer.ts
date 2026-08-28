import {
  Input,
  UrlSource,
  BlobSource,
  ALL_FORMATS,
  BufferTarget,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import { copyMuxTracks } from './core.js';

export type MuxProgress = (
  progress: number,
  detail?: string,
  bytes?: { received: number; total: number }
) => void;

export interface MuxOptions {
  videoUrl: string;
  audioUrl: string;
  signal?: AbortSignal;
  onProgress?: MuxProgress;
  metadata?: { title?: string; artist?: string; album?: string };
  durationHint?: number;
  videoBytesHint?: number;
  // OPFS temp-file / session-id prefix, in case a consumer runs more than one
  // mux library in the same origin and needs to keep their scratch files apart
  filePrefix?: string;
  // URL of this package's built worker module (see the "./worker" export) —
  // required for the OPFS worker path; without it, falls back to main-thread muxing
  workerUrl?: string | URL;
}

export function isClientMuxSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof ReadableStream !== 'undefined'
  );
}

const DEFAULT_PREFIX = 'web-mux';
const muxFileName = (prefix: string, session: string, suffix: string) =>
  `${prefix}-${session}-${suffix}`;

const STALE_MUX_FILE_MS = 5 * 60 * 1000;

async function sweepStaleMuxFiles(prefix: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return;
  }
  try {
    const dir = await navigator.storage.getDirectory();
    const iterable = dir as unknown as {
      keys?: () => AsyncIterableIterator<string>;
    };
    if (typeof iterable.keys !== 'function') return;
    const re = new RegExp(`^${prefix}-(\\d+)-`);
    const now = Date.now();
    for await (const name of iterable.keys()) {
      const match = re.exec(name);
      if (!match) continue;
      const stamp = Number(match[1]);
      if (Number.isFinite(stamp) && now - stamp < STALE_MUX_FILE_MS) continue;
      await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    // best-effort cleanup
  }
}

async function openOpfsSink(name: string): Promise<{
  target: StreamTarget;
  getFile: () => Promise<File>;
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const stream = new WritableStream<StreamTargetChunk>({
      write: (chunk) => writable.write(chunk),
      close: () => writable.close(),
      abort: (reason) => writable.abort(reason),
    });
    return {
      target: new StreamTarget(stream),
      getFile: () => handle.getFile(),
    };
  } catch {
    return null;
  }
}

// buffers to OPFS for seekable decoding; falls back to a plain UrlSource without it
async function openBufferedInput(
  url: string,
  name: string,
  signal?: AbortSignal,
  onBytes?: (received: number, total: number) => void,
  totalHint = 0
): Promise<{ source: UrlSource | BlobSource; cleanup: () => Promise<void> }> {
  const noCleanup = async () => {};
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return { source: new UrlSource(url), cleanup: noCleanup };
  }
  try {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      await writable.abort().catch(() => {});
      throw new Error(`buffered fetch failed: ${response.status}`);
    }
    const headerTotal = Number(response.headers.get('content-length')) || 0;
    const total = headerTotal > 0 ? headerTotal : Math.max(0, totalHint);
    let received = 0;
    let lastDownPct = -1;
    let lastEmit = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
        const now = Date.now();
        if (pct !== lastDownPct || now - lastEmit >= 200) {
          lastDownPct = pct;
          lastEmit = now;
          onBytes?.(received, total);
        }
        controller.enqueue(chunk);
      },
    });
    await response.body.pipeThrough(counter).pipeTo(writable);

    if (headerTotal > 0 && received < headerTotal) {
      await dir.removeEntry(name).catch(() => {});
      const short = new Error(`fetch short: ${received}/${headerTotal}`);
      short.name = 'FetchIncomplete';
      throw short;
    }

    const file = await handle.getFile();
    return {
      source: new BlobSource(file),
      cleanup: async () => {
        try {
          await dir.removeEntry(name);
        } catch {
          // already gone
        }
      },
    };
  } catch (err) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(name);
    } catch {
      // already gone
    }
    const errName = (err as Error)?.name;
    if (errName === 'AbortError' || errName === 'FetchIncomplete') throw err;
    return { source: new UrlSource(url), cleanup: noCleanup };
  }
}

async function muxOnMainThread(options: MuxOptions): Promise<Blob> {
  const {
    videoUrl,
    audioUrl,
    signal,
    onProgress,
    metadata,
    durationHint,
    videoBytesHint,
    filePrefix = DEFAULT_PREFIX,
  } = options;

  void sweepStaleMuxFiles(filePrefix);

  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [videoIn, audioIn] = await Promise.all([
    openBufferedInput(
      videoUrl,
      muxFileName(filePrefix, session, 'v.bin'),
      signal,
      (received, total) => {
        if (onProgress && total > 0) {
          onProgress(
            Math.min(90, Math.round((received / total) * 90)),
            'Downloading video...',
            { received, total }
          );
        }
      },
      videoBytesHint
    ),
    openBufferedInput(
      audioUrl,
      muxFileName(filePrefix, session, 'a.bin'),
      signal
    ),
  ]);

  const videoInput = new Input({ source: videoIn.source, formats: ALL_FORMATS });
  const audioInput = new Input({ source: audioIn.source, formats: ALL_FORMATS });

  try {
    const sink = await openOpfsSink(muxFileName(filePrefix, session, 'out.mp4'));
    const target = sink ? sink.target : new BufferTarget();

    await copyMuxTracks({
      videoInput,
      audioInput,
      target,
      metadata,
      durationHint,
      signal,
      onProgress: onProgress
        ? (pct, detail) => onProgress(pct, detail)
        : undefined,
    });

    if (sink) return sink.getFile();
    const buffer = (target as BufferTarget).buffer;
    if (!buffer) throw new Error('Muxing produced no output');
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    await videoIn.cleanup();
    await audioIn.cleanup();
  }
}

function canUseMuxWorker(options: MuxOptions): boolean {
  return (
    !!options.workerUrl &&
    typeof Worker !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory
  );
}

// give the worker's own file-write settle before reclaiming the OPFS entry
function scheduleOpfsDelete(name: string): void {
  setTimeout(() => {
    void (async () => {
      try {
        const dir = await navigator.storage?.getDirectory?.();
        await dir?.removeEntry(name);
      } catch {
        // next sweep retries
      }
    })();
  }, 60000);
}

function muxViaWorker(options: MuxOptions): Promise<Blob> {
  const {
    videoUrl,
    audioUrl,
    signal,
    onProgress,
    metadata,
    durationHint,
    videoBytesHint,
    filePrefix = DEFAULT_PREFIX,
    workerUrl,
  } = options;

  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      const aborted = new Error('muxing aborted');
      aborted.name = 'AbortError';
      reject(aborted);
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(workerUrl as string | URL, { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;

    function cleanup() {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    }
    function onAbort() {
      if (settled) return;
      settled = true;
      try {
        worker.postMessage({ type: 'cancel' });
      } catch {
        // worker may already be gone
      }
      cleanup();
      const aborted = new Error('muxing aborted');
      aborted.name = 'AbortError';
      reject(aborted);
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        pct?: number;
        detail?: string;
        bytes?: { received: number; total: number };
        file?: Blob;
        outName?: string;
        name?: string;
        message?: string;
        tag?: string;
        usage?: number;
        quota?: number;
        ceiling?: number;
      };
      if (!msg) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.pct ?? 0, msg.detail, msg.bytes);
        return;
      }
      if (msg.type === 'diag') {
        const mb = (val?: number) =>
          typeof val === 'number' ? `${Math.round(val / 1048576)}MB` : '?';
        console.log(
          `[web-mux] storage ${msg.tag}: ${mb(msg.usage)} used / ${mb(msg.quota)} quota`
        );
        return;
      }
      if (settled) return;
      if (msg.type === 'done' && msg.file) {
        settled = true;
        cleanup();
        if (msg.outName) scheduleOpfsDelete(msg.outName);
        resolve(msg.file);
      } else if (msg.type === 'error') {
        settled = true;
        cleanup();
        const error = new Error(msg.message || 'mux worker failed') as Error & {
          ceiling?: number;
        };
        if (msg.name) error.name = msg.name;
        if (typeof msg.ceiling === 'number') error.ceiling = msg.ceiling;
        reject(error);
      }
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`mux worker crashed: ${event.message || 'unknown'}`));
    };

    worker.postMessage({
      type: 'start',
      videoUrl,
      audioUrl,
      metadata,
      durationHint,
      videoBytesHint,
      filePrefix,
    });
  });
}

// prefers the OPFS+Worker path (survives large files); falls back to buffered main-thread muxing
export function muxToMp4(options: MuxOptions): Promise<Blob> {
  const prefix = options.filePrefix ?? DEFAULT_PREFIX;
  if (canUseMuxWorker(options)) {
    void sweepStaleMuxFiles(prefix);
    void navigator.storage?.persist?.();
    return muxViaWorker(options);
  }
  return muxOnMainThread(options);
}
