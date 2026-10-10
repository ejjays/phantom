import { fetchWithTimeout } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { oshash } from '../../lib/oshash';
import type { SubtitleTrack } from '../../lib/subtitles';
import type { MovieRef } from './parse';
import { log } from '../../lib/log';

const OS_API = 'https://api.opensubtitles.com/api/v1';
const UA = 'Phantom v1.2';
const FETCH_TIMEOUT_MS = 10000;
const HASH_CHUNK = 65536;

function osKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OS_API_KEY;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

function baseHeaders(key: string): Record<string, string> {
  return {
    'Api-Key': key,
    'User-Agent': `${UA} ${DESKTOP_UA}`,
    Accept: 'application/json',
  };
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

type OsEntry = {
  fileId: number;
  impaired: boolean;
  foreignOnly: boolean;
  season?: number;
  episode?: number;
};

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function entriesOf(payload: unknown): OsEntry[] {
  const data = rec(payload)?.['data'];
  if (!Array.isArray(data)) return [];
  const out: OsEntry[] = [];
  for (const item of data) {
    const attrs = rec(rec(item)?.['attributes']);
    if (!attrs) continue;
    const files = attrs['files'];
    const first = Array.isArray(files) ? rec(files[0]) : null;
    const fileId = first?.['file_id'];
    if (typeof fileId !== 'number') continue;
    const details = rec(attrs['feature_details']);
    out.push({
      fileId,
      impaired: attrs['hearing_impaired'] === true,
      foreignOnly: attrs['foreign_parts_only'] === true,
      season: num(details?.['season_number']),
      episode: num(details?.['episode_number']),
    });
  }
  return out;
}

function pickFile(entries: OsEntry[]): number | null {
  const usable = entries.filter((entry) => !entry.foreignOnly);
  const pool = usable.length > 0 ? usable : entries;
  return (
    pool.find((entry) => !entry.impaired)?.fileId ?? pool[0]?.fileId ?? null
  );
}

async function searchEntries(url: string, key: string): Promise<OsEntry[]> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: baseHeaders(key) },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return [];
    return entriesOf(await res.json());
  } catch {
    return [];
  }
}

async function downloadTrack(
  fileId: number,
  key: string
): Promise<SubtitleTrack[]> {
  try {
    const res = await fetchWithTimeout(
      `${OS_API}/download`,
      {
        method: 'POST',
        headers: { ...baseHeaders(key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const link = rec(await res.json())?.['link'];
    if (typeof link !== 'string' || !/^https?:\/\//iu.test(link)) return [];
    return [{ label: 'English', lang: 'en', url: link }];
  } catch {
    return [];
  }
}

async function searchFiles(ref: MovieRef, key: string): Promise<OsEntry[]> {
  const params =
    ref.kind === 'movie'
      ? `tmdb_id=${encodeURIComponent(ref.tmdbId)}`
      : `parent_tmdb_id=${encodeURIComponent(ref.tmdbId)}&season_number=${encodeURIComponent(ref.season)}&episode_number=${encodeURIComponent(ref.episode)}`;
  const attempts =
    ref.kind === 'tv'
      ? [`${params}`, `tmdb_id=${encodeURIComponent(ref.tmdbId)}`]
      : [params];
  for (const query of attempts) {
    const found = await searchEntries(
      `${OS_API}/subtitles?${query}&languages=en&order_by=download_count&order_direction=desc`,
      key
    );
    if (ref.kind === 'tv' && query.startsWith('tmdb_id=')) {
      const season = Number(ref.season);
      const episode = Number(ref.episode);
      const matching = found.filter(
        (entry) => entry.season === season && entry.episode === episode
      );
      if (matching.length > 0) return matching;
      continue;
    }
    if (found.length > 0) return found;
  }
  return [];
}

export async function hashMediaUrl(
  url: string
): Promise<{ hash: string; size: number } | null> {
  try {
    const head = await fetchWithTimeout(
      url,
      { method: 'HEAD' },
      FETCH_TIMEOUT_MS
    );
    const size = Number(head.headers.get('content-length') ?? 0);
    if (!head.ok || !Number.isFinite(size) || size < 2 * HASH_CHUNK)
      return null;
    const range = async (
      start: number,
      end: number
    ): Promise<Uint8Array | null> => {
      try {
        const res = await fetchWithTimeout(
          url,
          { headers: { Range: `bytes=${start}-${end}` } },
          FETCH_TIMEOUT_MS
        );
        if (res.status !== 206) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.length >= HASH_CHUNK ? buf : null;
      } catch {
        return null;
      }
    };
    const [headBytes, tailBytes] = await Promise.all([
      range(0, HASH_CHUNK - 1),
      range(size - HASH_CHUNK, size - 1),
    ]);
    if (!headBytes || !tailBytes) return null;
    return { hash: oshash(headBytes, tailBytes, size), size };
  } catch {
    return null;
  }
}

export async function fetchOpenSubtitlesByHash(
  hash: string,
  fileSize: number
): Promise<SubtitleTrack[]> {
  const key = osKey();
  if (!key) return [];
  const started = Date.now();
  const found = await searchEntries(
    `${OS_API}/subtitles?moviehash=${hash}&moviebytesize=${fileSize}&languages=en&order_by=download_count&order_direction=desc`,
    key
  );
  const fileId = pickFile(found);
  if (fileId === null) return [];
  const tracks = await downloadTrack(fileId, key);
  if (tracks.length > 0) {
    log(
      'Subtitles',
      `opensubtitles hash file=${fileId} ms=${Date.now() - started}`
    );
  }
  return tracks;
}

export async function fetchOpenSubtitles(
  ref: MovieRef
): Promise<SubtitleTrack[]> {
  const key = osKey();
  if (!key) return [];
  const started = Date.now();
  const entries = await searchFiles(ref, key);
  const fileId = pickFile(entries);
  if (fileId === null) return [];
  const tracks = await downloadTrack(fileId, key);
  if (tracks.length > 0) {
    log(
      'Subtitles',
      `opensubtitles ${ref.kind}/${ref.tmdbId} file=${fileId} ms=${Date.now() - started}`
    );
  }
  return tracks;
}
