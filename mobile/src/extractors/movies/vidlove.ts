import {
  hlsVariantsToFormats,
  parseHlsMaster,
  type Format,
} from '@phantom/extractors';
import { fetchWithTimeout } from '../../lib/net';

// vidlove backends flap; never let one stall the title
const FETCH_TIMEOUT_MS = 8000;
import { log } from '../../lib/log';
import { langOfLabel, type SubtitleTrack } from '../../lib/subtitles';
import { DESKTOP_UA } from '../../lib/userAgents';
import { VIDLOVE_API, VIDLOVE_ORIGIN, VIDLOVE_PLAYER } from './constants';
import type { MovieRef } from './parse';

type VidloveQuality = { quality?: string; codec?: string; url?: string };

type VidloveSource = {
  source?: string;
  label?: string;
  url?: string;
  manifest?: string;
  qualities?: VidloveQuality[];
};

type VidloveSubtitle = { label?: string; file?: string };

type VidloveApi = {
  source?: VidloveSource | null;
  subtitles?: VidloveSubtitle[];
};

export function vidloveEmbedUrl(ref: MovieRef): string {
  return ref.kind === 'movie'
    ? `${VIDLOVE_PLAYER}/embed/movie/${ref.tmdbId}`
    : `${VIDLOVE_PLAYER}/embed/tv/${ref.tmdbId}/${ref.season}/${ref.episode}`;
}

export function vidloveHeaders(ref: MovieRef): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Referer: vidloveEmbedUrl(ref),
    Origin: VIDLOVE_ORIGIN,
  };
}

function apiUrls(ref: MovieRef): string[] {
  const base =
    ref.kind === 'movie'
      ? `${VIDLOVE_API}/movie?id=${encodeURIComponent(ref.tmdbId)}&mode=json`
      : `${VIDLOVE_API}/tv?id=${encodeURIComponent(ref.tmdbId)}&season=${encodeURIComponent(ref.season)}&episode=${encodeURIComponent(ref.episode)}&mode=json`;
  // moviebox2 lead server returns null for every probed title as of oct 2026, skip it
  return [base, `${base}&sources=vidapi`, `${base}&sources=moviebox`];
}

async function fetchApi(
  url: string,
  headers: Record<string, string>
): Promise<VidloveApi | null> {
  try {
    const res = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    return (await res.json()) as VidloveApi;
  } catch {
    return null;
  }
}

async function fetchSource(
  url: string,
  headers: Record<string, string>
): Promise<VidloveSource | null> {
  const data = await fetchApi(url, headers);
  const source = data?.source;
  if (!source || typeof source !== 'object' || !source.url) return null;
  return source;
}

function heightOf(label: string | undefined): number | undefined {
  const found = label?.match(/(\d{3,4})p/u)?.[1];
  const height = found ? Number(found) : NaN;
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

function qualityFormats(source: VidloveSource): Format[] {
  const out: Format[] = [];
  for (const entry of source.qualities ?? []) {
    if (!entry.url || !/^https?:\/\//u.test(entry.url)) continue;
    const height = heightOf(entry.quality);
    const label = height ? `${height}p` : (entry.quality ?? 'Source');
    const isHls = entry.url.includes('.m3u8');
    out.push({
      formatId: `vidlove-moviebox-${label.toLowerCase()}`,
      url: entry.url,
      extension: 'mp4',
      resolution: height ? `${Math.round((height * 16) / 9)}x${height}` : undefined,
      quality: label,
      width: height ? Math.round((height * 16) / 9) : undefined,
      height,
      vcodec: entry.codec ?? 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: false,
      isHls,
      hlsKeepAlive: true,
      note: `vidlove ${source.label ?? 'MovieBox'}`,
    });
  }
  return out;
}

function manifestFormats(source: VidloveSource, durationSec: number): Format[] {
  const manifest = source.manifest ?? '';
  if (!manifest.includes('#EXTM3U') || !source.url) return [];
  if (!manifest.includes('#EXT-X-STREAM-INF')) {
    return [
      {
        formatId: 'vidlove-vidapi-source',
        url: source.url,
        extension: 'mp4',
        quality: 'Source',
        vcodec: 'h264',
        acodec: 'aac',
        isMuxed: true,
        isVideo: true,
        isAudio: false,
        isHls: true,
        hlsKeepAlive: true,
        note: `vidlove ${source.label ?? 'VidAPI'}`,
      },
    ];
  }
  const master = parseHlsMaster(manifest, source.url);
  const variants = hlsVariantsToFormats(master, { durationSec }).map((variant) => ({
    ...variant,
    formatId: `vidlove-vidapi-${variant.formatId}`,
    hlsKeepAlive: true,
    note: `vidlove ${source.label ?? 'VidAPI'}`,
  }));
  const top = variants[0];
  const auto: Format[] =
    top && source.url
      ? [
          {
            formatId: 'vidlove-vidapi-auto',
            url: source.url,
            extension: 'mp4',
            resolution: top.resolution,
            quality: 'Auto',
            width: top.width,
            height: top.height,
            vcodec: 'h264',
            acodec: 'aac',
            isMuxed: true,
            isVideo: true,
            isAudio: false,
            isHls: true,
            hlsKeepAlive: true,
            note: `vidlove ${source.label ?? 'VidAPI'}`,
          },
        ]
      : [];
  return [...auto, ...variants];
}

// subtitle lists ride along with whichever backend answered, and only some of
// them carry them — ask every server at once and merge what comes back
export async function fetchVidloveSubtitles(
  ref: MovieRef
): Promise<SubtitleTrack[]> {
  const headers = vidloveHeaders(ref);
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();
  const collect = (responses: (VidloveApi | null)[]): void => {
    for (const data of responses) {
      for (const entry of data?.subtitles ?? []) {
        const file = entry?.file;
        if (!file || !/^https?:\/\//u.test(file) || seen.has(file)) continue;
        const label = entry.label?.trim() || 'Unknown';
        seen.add(file);
        out.push({ label, lang: langOfLabel(label), url: file });
      }
    }
  };
  collect(
    await Promise.all(apiUrls(ref).map((url) => fetchApi(url, headers)))
  );
  // subtitle lists flap between backends just like streams do: one retry
  // before concluding the title genuinely has none
  if (out.length === 0) {
    await new Promise((done) => setTimeout(done, 1500));
    collect(
      await Promise.all(apiUrls(ref).map((url) => fetchApi(url, headers)))
    );
    if (out.length > 0) {
      log('Movies', `vidlove retry found subtitles for ${ref.kind}/${ref.tmdbId}`);
    }
  }
  return out;
}

export async function fetchVidloveFormats(
  ref: MovieRef,
  durationSec: number
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  const headers = vidloveHeaders(ref);
  const seen = new Set<string>();
  const formats: Format[] = [];
  // backends sign the same stream with different urls, so dedupe on the
  // human label (auto/1080p/720p per source) instead of the url
  const dedupeKey = (format: Format): string =>
    `${format.formatId}|${format.height ?? ''}|${format.isHls ? 'hls' : 'file'}`;
  // servers are uneven and partially redundant: a 480p moviebox hit must not
  // hide a 1080p vidapi one, and every rung matters as a stall fallback.
  // parallel fetch keeps the wall-clock cost of walking them all at one round.
  const collect = (responses: (VidloveSource | null)[]): void => {
    for (const source of responses) {
      if (!source) continue;
      const candidates =
        source.manifest?.includes('#EXTM3U') ?? false
          ? manifestFormats(source, durationSec)
          : qualityFormats(source);
      for (const format of candidates) {
        const key = dedupeKey(format);
        if (seen.has(key)) continue;
        seen.add(key);
        formats.push(format);
      }
    }
  };
  collect(
    await Promise.all(apiUrls(ref).map((url) => fetchSource(url, headers)))
  );
  // vidapi backends flap empty while moviebox answers: one retry so a cam
  // mp4 is never the only option when a clean encode exists
  if (
    formats.length > 0 &&
    formats.every((format) => format.formatId.includes('moviebox'))
  ) {
    await new Promise((done) => setTimeout(done, 1500));
    collect(
      await Promise.all(apiUrls(ref).map((url) => fetchSource(url, headers)))
    );
    if (formats.some((format) => !format.formatId.includes('moviebox'))) {
      log('Movies', `vidlove retry found clean for ${ref.kind}/${ref.tmdbId}`);
    }
  }
  if (formats.length === 0) return null;
  // moviebox mp4s proved untrustworthy (cams, and once a different film
  // behind the id), so they rank below every vidapi rung: clean encodes
  // first, adaptive auto at the very top, moviebox only as last resort
  const rank = (format: Format): number =>
    format.formatId.includes('moviebox') ? 0 : 1;
  const autoRank = (format: Format): number =>
    format.formatId.endsWith('-auto') ? 1 : 0;
  formats.sort(
    (lhs, rhs) =>
      autoRank(rhs) - autoRank(lhs) ||
      rank(rhs) - rank(lhs) ||
      (rhs.height ?? 0) - (lhs.height ?? 0)
  );
  return { formats, headers };
}
