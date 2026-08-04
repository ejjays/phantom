import {
  ALL_FORMATS,
  Conversion,
  Mp3OutputFormat,
  Input,
  Output,
  BufferTarget,
  UrlSource,
} from 'mediabunny';

export type DownloadUpdate =
  | { status: 'connecting'; progress: number }
  | { status: 'downloading'; progress: number }
  | { status: 'complete'; progress: number; file: File }
  | { status: 'error'; error: string };

export class DownloadService {
  private onUpdate: (data: DownloadUpdate) => void;
  private abortController: AbortController | null = null;

  constructor(onUpdate: (data: DownloadUpdate) => void) {
    this.onUpdate = onUpdate;
    this.abortController = null;
  }

  async start(
    url: string,
    filename: string,
    options: RequestInit = {}
  ): Promise<void> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      this.onUpdate({ status: 'connecting', progress: 0 });

      const response = await fetch(url, { signal, ...options });
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      if (!response.body) throw new Error('Response body is null');
      const reader = response.body.getReader();
      const contentLength = Number(response.headers.get('Content-Length') || 0);
      const storage = await OPFSStorage.init(filename);
      if (!storage) throw new Error('Failed to initialize storage');

      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        await storage.write(value);
        receivedLength += value.length;

        if (contentLength) {
          const progress = Math.round((receivedLength / contentLength) * 100);
          this.onUpdate({ status: 'downloading', progress });
        }
      }

      const file = await storage.getFile();
      this.onUpdate({ status: 'complete', progress: 100, file });
      await storage.close();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : String(err);
      this.onUpdate({ status: 'error', error: message });
    }
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

import { OPFSStorage } from './opfs';
import type { VideoInfo, Format } from '@shared/schemas/media.schema.js';

export type ExtractedAudio = { blob: Blob; filename: string };

export interface AudioExtractOpts {
  info: VideoInfo;
  proxyBase: string;
  abortSignal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function selectBestAudio(info: VideoInfo): Format | null {
  const candidates = [
    ...(info.audioFormats || []),
    ...(info.formats || []).filter((f) => f.isAudio && !f.isVideo),
  ];
  return candidates.reduce<Format | null>((best, fmt) => {
    if (!fmt.url || !fmt.isAudio) return best;
    if (!best) return fmt;
    if (!best.tbr) return fmt;
    return (fmt.tbr || 0) > (best.tbr || 0) ? fmt : best;
  }, null);
}

function proxyIfNeeded(rawUrl: string, proxyBase: string): string {
  try {
    const { hostname } = new URL(rawUrl);
    const isYt =
      hostname.endsWith('youtube.com') ||
      hostname.endsWith('googlevideo.com') ||
      hostname.endsWith('ytimg.com');
    if (isYt) return `${proxyBase}/proxy?u=${encodeURIComponent(rawUrl)}`;
  } catch {
    /* not a url — leave as-is */
  }
  return rawUrl;
}

export async function extractAudio(
  opts: AudioExtractOpts
): Promise<ExtractedAudio> {
  const { info, proxyBase, abortSignal, onProgress } = opts;
  const audio = selectBestAudio(info);
  if (!audio || !audio.url) throw new Error('No audio format available');

  const streamUrl = proxyIfNeeded(audio.url, proxyBase);
  onProgress?.(0);

  const target = new BufferTarget();
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(streamUrl),
  });
  const output = new Output({ format: new Mp3OutputFormat(), target });
  const conversion = await Conversion.init({ input, output });

  conversion.onProgress = (pct: number) => onProgress?.(Math.round(pct * 100));
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => conversion.cancel());
  }

  await conversion.execute();
  const buf = target.buffer;
  if (!buf) throw new Error('Audio extraction failed');

  const blob = new Blob([buf], { type: 'audio/mpeg' });

  const titleSafe = (info.title || 'audio')
    .replace(/[^a-z0-9]/gi, '_')
    .slice(0, 64);
  return { blob, filename: `${titleSafe}.mp3` };
}
