// off-main-thread download+mux to OPFS (createSyncAccessHandle is worker-only)
// so large files go disk-to-disk instead of hitting the tab's RAM ceiling.
// postMessage in: {type:'start',...} | {type:'cancel'}; out: progress/done/error
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import { copyMuxTracks } from './core.js';
import { resumableFetchToSink } from './resumableFetch.js';

interface SyncAccessHandle {
  write(buffer: Uint8Array, options?: { at?: number }): number;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}
interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

interface MuxStartMessage {
  type: 'start';
  videoUrl: string;
  audioUrl: string;
  metadata?: { title?: string; artist?: string; album?: string };
  durationHint?: number;
  videoBytesHint?: number;
  filePrefix?: string;
}

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const DEFAULT_PREFIX = 'web-mux';
const muxName = (prefix: string, session: string, suffix: string) =>
  `${prefix}-${session}-${suffix}`;

const FLUSH_INTERVAL = 32 * 1024 * 1024;
const RESUME_MAX_ATTEMPTS = 5;
const ORPHAN_AGE_MS = 60 * 1000;

const post = (
  pct: number,
  detail?: string,
  bytes?: { received: number; total: number }
) => ctx.postMessage({ type: 'progress', pct, detail, bytes });

async function fetchToDisk(
  dir: FileSystemDirectoryHandle,
  url: string,
  name: string,
  signal: AbortSignal,
  onBytes?: (received: number, total: number) => void
): Promise<File> {
  const handle = (await dir.getFileHandle(name, {
    create: true,
  })) as SyncFileHandle;
  const access = await handle.createSyncAccessHandle();
  let written = 0;
  let lastEmit = 0;
  try {
    const result = await resumableFetchToSink({
      url,
      signal,
      maxAttempts: RESUME_MAX_ATTEMPTS,
      flushEvery: FLUSH_INTERVAL,
      writeAt: (offset, chunk) => {
        access.write(chunk, { at: offset });
      },
      onFlush: async () => {
        await access.flush();
      },
      onProgress: (received, total) => {
        written = received;
        const now = Date.now();
        if (onBytes && now - lastEmit >= 200) {
          lastEmit = now;
          onBytes(received, total);
        }
      },
    });
    await access.flush();
    onBytes?.(result.received, result.total);
  } catch (err) {
    if ((err as { name?: string })?.name === 'QuotaExceededError') {
      (err as { ceiling?: number }).ceiling = written;
    }
    throw err;
  } finally {
    await access.close();
  }
  return handle.getFile();
}

async function muxToDisk(
  dir: FileSystemDirectoryHandle,
  videoFile: File,
  audioFile: File,
  outName: string,
  job: MuxStartMessage,
  signal: AbortSignal
): Promise<File> {
  const videoInput = new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS });
  const audioInput = new Input({ source: new BlobSource(audioFile), formats: ALL_FORMATS });

  const outHandle = (await dir.getFileHandle(outName, {
    create: true,
  })) as SyncFileHandle;
  const outAccess = await outHandle.createSyncAccessHandle();
  try {
    const outStream = new WritableStream<StreamTargetChunk>({
      write: (chunk) => {
        outAccess.write(chunk.data, { at: chunk.position });
      },
    });

    await copyMuxTracks({
      videoInput,
      audioInput,
      target: new StreamTarget(outStream),
      metadata: job.metadata,
      durationHint: job.durationHint,
      signal,
      onProgress: (pct, detail) => post(pct, detail),
    });

    await outAccess.flush();
  } finally {
    await outAccess.close();
  }
  return outHandle.getFile();
}

// reclaims space left by runs killed before their own cleanup ran
async function sweepOrphans(
  dir: FileSystemDirectoryHandle,
  prefix: string
): Promise<void> {
  const iterable = dir as unknown as {
    keys?: () => AsyncIterableIterator<string>;
  };
  if (typeof iterable.keys !== 'function') return;
  const re = new RegExp(`^${prefix}-(\\d+)-`);
  const now = Date.now();
  try {
    for await (const name of iterable.keys()) {
      const match = re.exec(name);
      if (!match) continue;
      const stamp = Number(match[1]);
      if (Number.isFinite(stamp) && now - stamp < ORPHAN_AGE_MS) continue;
      await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

async function reportStorage(tag: string): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      ctx.postMessage({
        type: 'diag',
        tag,
        usage: est.usage,
        quota: est.quota,
      });
    }
  } catch {
    // ignore estimate failure
  }
}

async function runJob(
  job: MuxStartMessage,
  signal: AbortSignal
): Promise<{ file: File; outName: string }> {
  const prefix = job.filePrefix ?? DEFAULT_PREFIX;
  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = await navigator.storage.getDirectory();
  await sweepOrphans(dir, prefix);
  await reportStorage('start');
  const videoName = muxName(prefix, session, 'v.bin');
  const audioName = muxName(prefix, session, 'a.bin');
  const outName = muxName(prefix, session, 'out.mp4');

  const drop = (name: string) => dir.removeEntry(name).catch(() => {});

  // combine both tracks for accurate overall progress
  let videoRecv = 0;
  let videoTotal = 0;
  let audioRecv = 0;
  let audioTotal = 0;
  const emitProgress = () => {
    const received = videoRecv + audioRecv;
    const total = videoTotal + audioTotal;
    if (total > 0) {
      post(Math.min(90, Math.round((received / total) * 90)), 'Downloading...', {
        received,
        total,
      });
    }
  };

  try {
    const [videoFile, audioFile] = await Promise.all([
      fetchToDisk(dir, job.videoUrl, videoName, signal, (received, total) => {
        videoRecv = received;
        videoTotal = total;
        emitProgress();
      }),
      fetchToDisk(dir, job.audioUrl, audioName, signal, (received, total) => {
        audioRecv = received;
        audioTotal = total;
        emitProgress();
      }),
    ]);

    const file = await muxToDisk(dir, videoFile, audioFile, outName, job, signal);
    await drop(videoName);
    await drop(audioName);
    return { file, outName };
  } catch (err) {
    const quota = (err as { name?: string })?.name === 'QuotaExceededError';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) {
        reportStorage('error');
        if (quota && typeof (err as { ceiling?: number }).ceiling !== 'number') {
          (err as { ceiling?: number }).ceiling = est.usage;
        }
      }
    } catch {
      // best-effort
    }
    await drop(videoName);
    await drop(audioName);
    await drop(outName);
    throw err;
  }
}

let activeController: AbortController | null = null;

ctx.onmessage = (event: MessageEvent) => {
  const data = event.data as { type?: string };
  if (data?.type === 'cancel') {
    activeController?.abort();
    return;
  }
  if (data?.type !== 'start') return;

  const controller = new AbortController();
  activeController = controller;
  runJob(event.data as MuxStartMessage, controller.signal)
    .then(({ file, outName }) => ctx.postMessage({ type: 'done', file, outName }))
    .catch((err: unknown) => {
      const error = err as Error & { ceiling?: number };
      ctx.postMessage({
        type: 'error',
        name: error?.name,
        message: error?.message,
        ceiling: error?.ceiling,
      });
    })
    .finally(() => {
      if (activeController === controller) activeController = null;
    });
};
