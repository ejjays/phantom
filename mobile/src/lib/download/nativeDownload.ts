import { File, Paths } from 'expo-file-system';
import { startDownload, type DownloadJob } from '../../../modules/native-downloader';

// native streaming download replaces the old 4MB/4x array-buffer chunks:
// okhttp writes straight to disk on one connection, no js hop per chunk.
// js side keeps the same sidecar contract so a failure falls back to the
// js chunked path and resumes from the same byte count.

const JOB_PREFIX = 'dl';

type ResumeState = { url: string; total: number };

const statePath = (file: File): File =>
  new File(Paths.cache, `${file.name}.nstate`);

// js chunked path writes .state sidecars; reuse them so a switch between
// paths (or an interrupted native run) still resumes mid-file
const jsStatePath = (file: File): File =>
  new File(Paths.cache, `${file.name}.state`);

async function readState(file: File): Promise<ResumeState | null> {
  const jsSidecar = jsStatePath(file);
  if (jsSidecar.exists) {
    try {
      const raw = await jsSidecar.text();
      const parsed = raw ? (JSON.parse(raw) as ResumeState & { chunk?: number }) : null;
      if (parsed && parsed.url && typeof parsed.total === 'number') return parsed;
    } catch {
      /* unreadable sidecar = no resume point */
    }
  }
  const nativeSidecar = statePath(file);
  if (nativeSidecar.exists) {
    try {
      const raw = await nativeSidecar.text();
      const parsed = raw ? (JSON.parse(raw) as ResumeState) : null;
      if (parsed && parsed.url && typeof parsed.total === 'number') return parsed;
    } catch {
      /* unreadable sidecar = no resume point */
    }
  }
  return null;
}

const clearState = (file: File): void => {
  for (const sidecar of [statePath(file), jsStatePath(file)]) {
    if (sidecar.exists) sidecar.delete();
  }
};

export function nativeDownload(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const jobId = `${JOB_PREFIX}-${file.name}-${Date.now()}`;
    let job: DownloadJob | null = null;
    let done = false;

    const abortHandler = (): void => {
      job?.cancel();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    void (async () => {
      try {
        // partial kept from a failed run resumes from its byte count;
        // a leftover fragment without a sidecar wipes and restarts
        let resumeBytes = 0;
        const prev = await readState(file);
        if (
          prev &&
          prev.url === url &&
          file.exists &&
          file.size > 0 &&
          file.size < (prev.total || Number.POSITIVE_INFINITY)
        ) {
          resumeBytes = file.size;
        } else {
          if (file.exists) file.delete();
          file.create();
        }
        job = startDownload(
          jobId,
          url,
          decodeURIComponent(file.uri.replace(/^file:\/\//u, '')), // native wants a raw path
          headers,
          resumeBytes,
          (e) => {
            if (e.jobId === jobId) onProgress(e.bytes, e.total);
          },
          (e) => {
            if (e.jobId !== jobId || done) return;
            done = true;
            signal?.removeEventListener('abort', abortHandler);
            if (e.state === 'failed') {
              reject(
                // same shape as the js chunked path so the pipeline's
                // 403 -> refreshStreamUrl hook keeps working
                new Error(
                  `chunked: HTTP ${e.httpCode ?? '?'} — ${e.error ?? ''}`
                )
              );
            } else if (e.state === 'cancelled') {
              reject(new Error('download cancelled'));
            } else {
              clearState(file);
              resolve();
            }
          },
          // 4 parallel range streams for files over 50MB — the single
          // stream caps ~1.2MB/s on googlevideo while curl hits 2.6;
          // parallel regions multiply the same per-stream ceiling
          prev?.total && prev.total > 50 * 1048576 ? 4 : 1
        );
      } catch (err) {
        reject(err);
      }
    })();
  });
}