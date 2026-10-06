import { gatedFetch } from './net';

export type ThumbSegment = { uri: string; duration: number };

export const SEGMENT_BYTE_CAP = 8 * 1024 * 1024;

const PLAYLIST_CACHE = 8;

const playlistCache = new Map<string, ThumbSegment[]>();

export function parseThumbSegments(
  text: string,
  baseUrl: string
): ThumbSegment[] {
  const out: ThumbSegment[] = [];
  let pending: number | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const duration = Number(line.slice(8).split(',')[0]);
      pending = Number.isFinite(duration) && duration > 0 ? duration : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pending === null) continue;
    try {
      out.push({ uri: new URL(line, baseUrl).toString(), duration: pending });
    } catch {
      continue;
    } finally {
      pending = null;
    }
  }
  return out;
}

export function segmentIndexAt(
  segments: ThumbSegment[],
  timeSec: number
): number {
  let acc = 0;
  for (let i = 0; i < segments.length; i += 1) {
    acc += segments[i].duration;
    if (timeSec < acc) return i;
  }
  return segments.length - 1;
}

export async function fetchThumbSegments(
  playlistUrl: string,
  headers: Record<string, string>
): Promise<ThumbSegment[] | null> {
  const hit = playlistCache.get(playlistUrl);
  if (hit) return hit;
  try {
    const res = await gatedFetch(playlistUrl, { headers });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.includes('#EXTM3U') || text.includes('#EXT-X-STREAM-INF'))
      return null;
    const segments = parseThumbSegments(text, playlistUrl);
    if (segments.length === 0) return null;
    if (playlistCache.size >= PLAYLIST_CACHE) {
      const oldest = playlistCache.keys().next();
      if (!oldest.done) playlistCache.delete(oldest.value);
    }
    playlistCache.set(playlistUrl, segments);
    return segments;
  } catch {
    return null;
  }
}

export async function fetchBytesCapped(
  url: string,
  headers: Record<string, string>,
  cap: number = SEGMENT_BYTE_CAP
): Promise<Uint8Array | null> {
  try {
    const res = await gatedFetch(url, { headers });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > cap ? bytes.slice(0, cap) : bytes;
  } catch {
    return null;
  }
}
