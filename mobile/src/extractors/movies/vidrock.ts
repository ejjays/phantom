import {
  hlsVariantsToFormats,
  parseHlsMaster,
  type Format,
} from '@phantom/extractors';
import { fetchWithTimeout } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { log } from '../../lib/log';

// one wedged cdn host must not stall the whole title
const FETCH_TIMEOUT_MS = 8000;
import { VIDROCK_API, VIDROCK_KEY_HEX, VIDROCK_REFERER } from './constants';
import { decryptVidrockPayload } from './aesgcm';
import type { MovieRef } from './parse';

export const VIDROCK_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  Referer: VIDROCK_REFERER,
  Origin: VIDROCK_REFERER.replace(/\/$/u, ''),
};

type VidrockEntry = {
  url: string | null;
  type: string | null;
  language?: string;
  flag?: string;
};

type VidrockApi = Record<string, VidrockEntry>;

export type VidrockSource = {
  name: string;
  url: string;
  streamType: string;
  language?: string;
};

const blockedHosts = new Set<string>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function looksBlocked(
  status: number,
  contentType: string,
  body: string
): boolean {
  if (status !== 403 && status !== 429 && status !== 503) return false;
  if (!contentType.includes('text/html')) return false;
  return /just a moment|attention required|cf-chl|challenge-platform|turnstile|access blocked|access denied|are you human|captcha/iu.test(
    body.slice(0, 4000)
  );
}

function markBlocked(
  url: string,
  status: number,
  contentType: string,
  body: string
): void {
  if (!looksBlocked(status, contentType, body)) return;
  const host = hostOf(url);
  if (host) blockedHosts.add(host);
}

export function hasBlockedHosts(): boolean {
  return blockedHosts.size > 0;
}

export function vidrockPath(ref: MovieRef): string {
  return ref.kind === 'movie'
    ? `movie/${ref.tmdbId}`
    : `tv/${ref.tmdbId}/${ref.season}/${ref.episode}`;
}

export async function fetchVidrockSources(
  ref: MovieRef
): Promise<VidrockSource[]> {
  blockedHosts.clear();
  const res = await fetchWithTimeout(
    `${VIDROCK_API}/${vidrockPath(ref)}`,
    {
      headers: VIDROCK_HEADERS,
    },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`vidrock ${res.status}`);
  const api = (await res.json()) as VidrockApi;
  const out: VidrockSource[] = [];
  for (const [name, entry] of Object.entries(api)) {
    if (!entry || typeof entry !== 'object' || !entry.url) continue;
    try {
      const url = decryptVidrockPayload(entry.url, VIDROCK_KEY_HEX);
      if (!/^https?:\/\//u.test(url)) continue;
      const language =
        typeof entry.language === 'string' ? entry.language : undefined;
      out.push({ name, url, streamType: entry.type ?? '', language });
    } catch {
      continue;
    }
  }
  out.sort((lhs, rhs) => langRank(lhs.language) - langRank(rhs.language));
  log(
    'Movies',
    `vidrock servers ${out.map((source) => serverLabel(source)).join(',')}`
  );
  return out;
}

function langRank(language: string | undefined): number {
  if (!language) return 1;
  return /^english/iu.test(language) ? 0 : 2;
}

function serverLabel(source: VidrockSource): string {
  return `${source.name}:${source.language ?? '?'}`;
}

type QualityLevel = { resolution?: number; url?: string };

async function jsonLevels(url: string): Promise<QualityLevel[] | null> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: VIDROCK_HEADERS },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      markBlocked(url, res.status, res.headers.get('content-type') ?? '', body);
      return null;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) {
      if (type.includes('text/html')) {
        const body = await res.text().catch(() => '');
        markBlocked(url, res.status, type, body);
      }
      return null;
    }
    const data = (await res.json()) as QualityLevel[];
    if (!Array.isArray(data) || data.length === 0 || !data[0].url) return null;
    return [...data].sort(
      (lhs, rhs) => (rhs.resolution ?? 0) - (lhs.resolution ?? 0)
    );
  } catch {
    return null;
  }
}

async function playlistText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: VIDROCK_HEADERS },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      markBlocked(url, res.status, res.headers.get('content-type') ?? '', body);
      return null;
    }
    const text = await res.text();
    if (!text.includes('#EXTM3U')) {
      markBlocked(url, res.status, res.headers.get('content-type') ?? '', text);
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

export function mp4Format(name: string, url: string): Format {
  return {
    formatId: `vidrock-${name.toLowerCase()}-1080p`,
    url,
    extension: 'mp4',
    resolution: '1920x1080',
    quality: '1080p',
    width: 1920,
    height: 1080,
    vcodec: 'h264',
    acodec: 'aac',
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    note: `vidrock ${name}`,
  };
}

export function singleHls(
  name: string,
  url: string,
  filesize?: number
): Format {
  return {
    formatId: `vidrock-${name.toLowerCase()}-1080p`,
    url,
    extension: 'mp4',
    resolution: '1920x1080',
    quality: '1080p',
    width: 1920,
    height: 1080,
    filesize,
    vcodec: 'h264',
    acodec: 'aac',
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    isHls: true,
    hlsKeepAlive: true,
    note: `vidrock ${name} hls`,
  };
}

function playlistSegments(playlist: string, base: string): string[] {
  const out: string[] = [];
  for (const raw of playlist.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      out.push(new URL(line, base).toString());
    } catch {
      continue;
    }
  }
  return out;
}

function probeSingleHls(
  url: string,
  playlist: string
): Promise<{ dead: boolean; filesize?: number }> {
  const all = playlistSegments(playlist, url);
  if (all.length === 0) return Promise.resolve({ dead: true });
  return sampleSegments(all.slice(0, 2), all.length);
}

// mean segment bytes × segment count — measures the real stream instead
// of trusting the master playlist's (often inflated) BANDWIDTH claim
async function sampleSegments(
  picks: string[],
  totalSegments: number
): Promise<{ dead: boolean; filesize?: number }> {
  let total = 0;
  let count = 0;
  for (const seg of picks) {
    try {
      const head = await fetchWithTimeout(
        seg,
        { method: 'HEAD', headers: VIDROCK_HEADERS },
        FETCH_TIMEOUT_MS
      );
      if ((head.headers.get('content-type') ?? '').startsWith('image/')) {
        return { dead: true };
      }
      if (!head.ok) continue;
      const len = Number(head.headers.get('content-length') ?? 0);
      if (Number.isFinite(len) && len > 0) {
        total += len;
        count += 1;
      }
    } catch {
      continue;
    }
  }
  if (count === 0) return { dead: false };
  return { dead: false, filesize: Math.round((total / count) * totalSegments) };
}

// master BANDWIDTH claims run ~2-3x hot — sample each variant's real
// media playlist instead, falling back to the claim when probing fails
async function estimateVariantSize(
  variantUrl: string
): Promise<number | undefined> {
  try {
    const res = await fetchWithTimeout(
      variantUrl,
      { headers: VIDROCK_HEADERS },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return undefined;
    const text = await res.text();
    if (!text.includes('#EXTM3U') || text.includes('#EXT-X-STREAM-INF')) {
      return undefined;
    }
    const all = playlistSegments(text, variantUrl);
    if (all.length === 0) return undefined;
    const picks = [
      all[0],
      all[Math.floor(all.length / 2)],
      all[all.length - 1],
    ].filter((seg, idx, arr) => seg && arr.indexOf(seg) === idx);
    const { dead, filesize } = await sampleSegments(
      picks.slice(0, 3),
      all.length
    );
    return dead ? undefined : filesize;
  } catch {
    return undefined;
  }
}

export async function vidrockToFormats(
  sources: VidrockSource[],
  durationSec: number,
  opts?: { quick?: boolean }
): Promise<Format[]> {
  const formats: Format[] = [];
  const autos: Format[] = [];
  const seen = new Set<string>();
  const push = (format: Format): void => {
    const key = `${format.height ?? format.formatId}|${format.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    formats.push(format);
  };

  for (const source of sources) {
    const levels = await jsonLevels(source.url);
    if (levels) {
      for (const level of levels) {
        if (!level.url) continue;
        const height = level.resolution ?? 0;
        const label = height > 0 ? `${height}p` : 'source';
        push({
          formatId: `vidrock-${source.name.toLowerCase()}-${label}`,
          url: level.url,
          extension: 'mp4',
          quality: height > 0 ? label : 'Source',
          height: height > 0 ? height : undefined,
          vcodec: 'h264',
          acodec: 'aac',
          isMuxed: true,
          isVideo: true,
          isAudio: false,
          isHls: level.url.includes('.m3u8'),
          hlsKeepAlive: true,
          note: `vidrock ${source.name}`,
        });
      }
      continue;
    }

    if (source.streamType === 'mp4' && !source.url.includes('.m3u8')) {
      push(mp4Format(source.name, source.url));
      continue;
    }

    const playlist = await playlistText(source.url);
    if (!playlist) {
      if (source.url.includes('.mp4')) push(mp4Format(source.name, source.url));
      continue;
    }
    if (!playlist.includes('#EXT-X-STREAM-INF')) {
      const probe = await probeSingleHls(source.url, playlist);
      if (probe.dead) continue;
      push(singleHls(source.name, source.url, probe.filesize));
      continue;
    }
    const master = parseHlsMaster(playlist, source.url);
    const variants = hlsVariantsToFormats(master, { durationSec });
    const measured = opts?.quick
      ? variants.map(() => undefined)
      : await Promise.all(
          variants.map((variant) => estimateVariantSize(variant.url))
        );
    variants.forEach((variant, idx) => {
      push({
        ...variant,
        filesize: measured[idx] ?? variant.filesize,
        formatId: `vidrock-${source.name.toLowerCase()}-${variant.formatId}`,
        hlsKeepAlive: true,
        note: `vidrock ${source.name}`,
      });
    });
    const top = variants[0];
    if (top) {
      autos.push({
        formatId: `vidrock-${source.name.toLowerCase()}-auto`,
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
        note: `vidrock ${source.name}`,
      });
    }
  }

  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return [...autos, ...formats];
}
