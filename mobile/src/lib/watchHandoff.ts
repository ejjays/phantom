import type { Format, VideoInfo } from '@phantom/extractors';

export type WatchSubtitle = { url: string; lang: string; label: string };

export type WatchDownloadJob = {
  v: 1;
  id: string;
  url: string;
  headers: Record<string, string>;
  title: string;
  season: number | null;
  episode: number | null;
  quality: string | null;
  height: number | null;
  durationSec: number | null;
  poster: string | null;
  subtitles: WatchSubtitle[];
  saveSubdir: string;
  isHls: boolean;
  webpageUrl?: string;
};

export type HandoffMeta = {
  jobId: string;
  subtitles: WatchSubtitle[];
  saveSubdir: string;
};

export type HandoffInfo = VideoInfo & { handoff?: HandoffMeta };

const DEFAULT_SUBDIR = 'PhantomWatch';
const HTTP_URL = /^https?:\/\//iu;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;
const SUBDIR = /^[A-Za-z0-9._-]+$/u;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function integer(value: unknown, max: number): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
}

function httpUrl(value: unknown, max = 4096): string | null {
  const url = text(value, max);
  return url && HTTP_URL.test(url) ? url : null;
}

function headersOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (Object.keys(out).length >= 32) break;
    const name = rawName.trim();
    if (
      !HEADER_NAME.test(name) ||
      name === '__proto__' ||
      name === 'constructor' ||
      typeof rawValue !== 'string' ||
      rawValue.length > 4096
    ) {
      continue;
    }
    out[name] = rawValue;
  }
  return out;
}

function subtitlesOf(value: unknown): WatchSubtitle[] {
  if (!Array.isArray(value)) return [];
  const out: WatchSubtitle[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const url = httpUrl(raw.url);
    if (!url) continue;
    out.push({
      url,
      lang: text(raw.lang, 16)?.toLowerCase() ?? 'en',
      label: text(raw.label, 80) ?? 'English',
    });
  }
  return out;
}

export function parseWatchJob(raw: string): WatchDownloadJob | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const job = value as Record<string, unknown>;
  if (job.v !== 1) return null;
  const id = text(job.id, 120);
  const url = httpUrl(job.url);
  const title = text(job.title, 200);
  if (!id || !url || !title) return null;
  const subdir = text(job.saveSubdir, 48);
  const safeSubdir =
    subdir && !subdir.startsWith('.') && SUBDIR.test(subdir)
      ? subdir
      : DEFAULT_SUBDIR;
  return {
    v: 1,
    id,
    url,
    headers: headersOf(job.headers),
    title,
    season: integer(job.season, 999),
    episode: integer(job.episode, 9999),
    quality: text(job.quality, 40),
    height: integer(job.height, 4320),
    durationSec: integer(job.durationSec, 86_400),
    poster: httpUrl(job.poster, 2048),
    subtitles: subtitlesOf(job.subtitles),
    saveSubdir: safeSubdir,
    isHls: job.isHls === true || /\.m3u8(?:$|\?)/iu.test(url),
    webpageUrl: httpUrl(job.webpageUrl, 2048) ?? undefined,
  };
}

export function watchTitle(job: WatchDownloadJob): string {
  if (job.season === null || job.episode === null) return job.title;
  return `${job.title} S${String(job.season).padStart(2, '0')}E${String(
    job.episode
  ).padStart(2, '0')}`;
}

export function buildWatchMedia(job: WatchDownloadJob): {
  info: HandoffInfo;
  format: Format;
} {
  const quality = job.quality ?? (job.height ? `${job.height}p` : 'Auto');
  const format: Format = {
    formatId: `watch-${job.id}`,
    url: job.url,
    extension: 'mp4',
    quality,
    height: job.height ?? undefined,
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    isHls: job.isHls,
  };
  const info: HandoffInfo = {
    type: 'video',
    id: job.id,
    title: watchTitle(job),
    uploader: 'Phantom Watch',
    webpageUrl: job.webpageUrl ?? 'https://phantomwatch.local',
    thumbnail: job.poster ?? undefined,
    duration: job.durationSec ?? undefined,
    formats: [format],
    extractorKey: 'phantomwatch',
    isJsInfo: false,
    fromBrain: false,
    isPartial: false,
    isIsrcMatch: false,
    isFullData: true,
    downloadHeaders: job.headers,
    handoff: {
      jobId: job.id,
      subtitles: job.subtitles,
      saveSubdir: job.saveSubdir,
    },
  };
  return { info, format };
}

export function handoffOf(info: VideoInfo): HandoffMeta | undefined {
  return (info as HandoffInfo).handoff;
}

export function handoffSubdir(info: VideoInfo): string | undefined {
  return handoffOf(info)?.saveSubdir;
}
