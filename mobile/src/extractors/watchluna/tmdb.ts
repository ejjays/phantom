import { gatedFetch } from '../../lib/net';
import { error as logError } from '../../lib/log';
import type { LunaKind } from './browse';

export type TmdbPerson = {
  name: string;
  photo?: string;
};

export type TmdbCredits = {
  cast: TmdbPerson[];
  director?: TmdbPerson;
};

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const CAST_LIMIT = 8;

const cache = new Map<string, TmdbCredits | null>();

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_TMDB_API_KEY;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

function photoOf(path: unknown): string | undefined {
  return typeof path === 'string' && path.startsWith('/')
    ? `${TMDB_IMG}/w185${path}`
    : undefined;
}

function personOf(entry: unknown): TmdbPerson | null {
  const rec = entry as Record<string, unknown> | null;
  if (!rec || typeof rec['name'] !== 'string') return null;
  const person: TmdbPerson = { name: rec['name'] };
  const photo = photoOf(rec['profile_path']);
  if (photo) person.photo = photo;
  return person;
}

export async function fetchCredits(kind: LunaKind, tmdbId: string): Promise<TmdbCredits | null> {
  const cacheKey = `${kind}/${tmdbId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await gatedFetch(
      `${TMDB_API}/${kind}/${encodeURIComponent(tmdbId)}/credits?api_key=${encodeURIComponent(key)}&language=en-US`
    );
    if (!res.ok) {
      cache.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as {
      cast?: unknown;
      crew?: unknown;
    };
    const cast: TmdbPerson[] = [];
    if (Array.isArray(data.cast)) {
      for (const entry of data.cast) {
        const person = personOf(entry);
        if (person) cast.push(person);
        if (cast.length >= CAST_LIMIT) break;
      }
    }
    let director: TmdbPerson | undefined;
    if (Array.isArray(data.crew)) {
      for (const entry of data.crew) {
        const rec = entry as Record<string, unknown> | null;
        if (rec?.['job'] === 'Director') {
          director = personOf(entry) ?? undefined;
          break;
        }
      }
    }
    const credits: TmdbCredits = director ? { cast, director } : { cast };
    if (cache.size > 100) cache.clear();
    cache.set(cacheKey, credits);
    return credits;
  } catch (err) {
    logError('Movies', `credits ${cacheKey} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
