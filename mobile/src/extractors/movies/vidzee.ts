import type { Format } from '@phantom/extractors';
import { fetchWithTimeout } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { VIDZEE_API, VIDZEE_ORIGIN, VIDZEE_PLAYER } from './constants';
import type { MovieRef } from './parse';
import { log } from '../../lib/log';

const FETCH_TIMEOUT_MS = 8000;

// the player's own server list, in its order
const SERVERS = ['dcloud', 'tik', 'ipcloud'];

export function vidzeeStreamUrl(ref: MovieRef, server: string): string {
  const path =
    ref.kind === 'movie'
      ? `/streams/movie/${encodeURIComponent(ref.tmdbId)}`
      : `/streams/tv/${encodeURIComponent(ref.tmdbId)}/${encodeURIComponent(ref.season)}/${encodeURIComponent(ref.episode)}`;
  return `${VIDZEE_API}${path}?s=${encodeURIComponent(server)}&e=0`;
}

export function vidzeeEmbedUrl(ref: MovieRef): string {
  return ref.kind === 'movie'
    ? `${VIDZEE_PLAYER}/embed/movie/${ref.tmdbId}`
    : `${VIDZEE_PLAYER}/embed/tv/${ref.tmdbId}/${ref.season}/${ref.episode}`;
}

export function vidzeeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Referer: `${VIDZEE_ORIGIN}/`,
    Origin: VIDZEE_ORIGIN,
    ...extra,
  };
}

type VidzeeApi = {
  url?: unknown;
  language?: unknown;
  headers?: unknown;
};

type ServerHit = {
  sr: string;
  url: string;
  headers: Record<string, string>;
};

function extraHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

async function fetchServer(ref: MovieRef, sr: string): Promise<ServerHit | null> {
  let res: Response | null = null;
  try {
    res = await fetchWithTimeout(
      vidzeeStreamUrl(ref, sr),
      { headers: vidzeeHeaders() },
      FETCH_TIMEOUT_MS
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as VidzeeApi | null;
  const url = data?.url;
  if (typeof url !== 'string' || !/^https?:\/\//iu.test(url)) return null;
  return { sr, url, headers: vidzeeHeaders(extraHeaders(data?.headers)) };
}

export async function fetchVidzeeFormats(
  ref: MovieRef
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  const started = Date.now();
  const settled = await Promise.all(SERVERS.map((sr) => fetchServer(ref, sr)));
  const seen = new Set<string>();
  const formats: Format[] = [];
  let headers = vidzeeHeaders();
  for (const hit of settled) {
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    headers = hit.headers;
    formats.push({
      formatId: `vidzee-${hit.sr}-auto`,
      url: hit.url,
      extension: 'mp4',
      quality: 'Auto',
      vcodec: 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: false,
      isHls: true,
      hlsKeepAlive: true,
      note: `vidzee ${hit.sr}`,
    });
  }
  if (formats.length === 0) return null;
  log(
    'Movies',
    `vidzee ${ref.kind}/${ref.tmdbId} formats=${formats.length} ms=${Date.now() - started}`
  );
  return { formats, headers };
}
