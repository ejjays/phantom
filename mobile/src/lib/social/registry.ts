import { gatedFetch } from '../net';

// read-only mirror of the backend edge registry (spotify_mappings).
// bundled EXPO_PUBLIC_* vars are public, so token must be read-only.
const TURSO_URL = (process.env.EXPO_PUBLIC_TURSO_URL ?? '').trim();
const TURSO_READ_TOKEN = (
  process.env.EXPO_PUBLIC_TURSO_READ_TOKEN ?? ''
).trim();

const isRegistryConfigured =
  TURSO_URL.length > 0 && TURSO_READ_TOKEN.length > 0;

export type SpotifyMapping = {
  youtubeUrl: string;
  title: string;
  artist: string;
  cover?: string;
  durationMs: number;
  isrc?: string;
};

type Cell = { type: string; value?: string | null };

// col order (SELECT): title, artist, imageUrl, duration, isrc, youtubeUrl
export function parseMappingRow(
  row: Cell[] | undefined
): SpotifyMapping | null {
  if (!row || row.length < 6) return null;
  const val = (index: number): string => {
    const cell = row[index];
    return cell && typeof cell.value === 'string' ? cell.value : '';
  };
  const youtubeUrl = val(5);
  if (!/^https?:\/\//u.test(youtubeUrl)) return null;
  const title = val(0);
  const artist = val(1);
  if (!title || !artist) return null;
  return {
    youtubeUrl,
    title,
    artist,
    cover: val(2) || undefined,
    durationMs: (Number(val(3)) || 0) * 1000,
    isrc: val(4) || undefined,
  };
}

function httpBase(): string {
  return TURSO_URL.replace('libsql://', 'https://').replace(/\/+$/u, '');
}

const LOOKUP_TIMEOUT_MS = 4000;

// best-effort registry read; never throws, never blocks resolution
export async function lookupSpotifyMapping(
  cleanUrl: string
): Promise<SpotifyMapping | null> {
  if (!isRegistryConfigured) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await gatedFetch(`${httpBase()}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TURSO_READ_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            type: 'execute',
            stmt: {
              sql: 'SELECT title, artist, imageUrl, duration, isrc, youtubeUrl FROM spotify_mappings WHERE url = ? LIMIT 1',
              args: [{ type: 'text', value: cleanUrl }],
            },
          },
          { type: 'close' },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ response?: { result?: { rows?: Cell[][] } } }>;
    };
    return parseMappingRow(data?.results?.[0]?.response?.result?.rows?.[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
