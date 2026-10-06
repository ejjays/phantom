import {
  hlsVariantsToFormats,
  parseHlsMaster,
  type Format,
} from '@phantom/extractors';
import { gatedFetch } from '../../lib/net';
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

type VidloveApi = {
  source?: VidloveSource | null;
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

async function fetchSource(
  url: string,
  headers: Record<string, string>
): Promise<VidloveSource | null> {
  try {
    const res = await gatedFetch(url, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as VidloveApi;
    const source = data?.source;
    if (!source || typeof source !== 'object' || !source.url) return null;
    return source;
  } catch {
    return null;
  }
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

export async function fetchVidloveFormats(
  ref: MovieRef,
  durationSec: number
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  const headers = vidloveHeaders(ref);
  const seen = new Set<string>();
  const formats: Format[] = [];
  for (const url of apiUrls(ref)) {
    const source = await fetchSource(url, headers);
    if (!source) continue;
    const candidates =
      source.manifest?.includes('#EXTM3U') ?? false
        ? manifestFormats(source, durationSec)
        : qualityFormats(source);
    for (const format of candidates) {
      const key = `${format.height ?? format.formatId}|${format.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      formats.push(format);
    }
    if (formats.length > 0) break;
  }
  if (formats.length === 0) return null;
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return { formats, headers };
}
