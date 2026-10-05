import { gatedFetch } from '../../lib/net';
import { error as logError } from '../../lib/log';
import type { MovieKind } from './browse';

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

const cache = new Map<string, TmdbCredits | TmdbTitle | null>();

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

export type TmdbTitle = {
  title: string;
  image?: string;
  backdrop?: string;
  year?: string;
  rating?: number;
  votes?: number;
  genres: string[];
  description?: string;
  durationSec?: number;
};

function imageOf(path: unknown, size: string): string | undefined {
  return typeof path === 'string' && path.startsWith('/')
    ? `${TMDB_IMG}/${size}${path}`
    : undefined;
}

export async function fetchTmdbTitle(
  kind: MovieKind,
  tmdbId: string
): Promise<TmdbTitle | null> {
  const cacheKey = `title/${kind}/${tmdbId}`;
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    return hit && 'genres' in hit ? hit : null;
  }
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await gatedFetch(
      `${TMDB_API}/${kind}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(key)}&language=en-US`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const title =
      kind === 'movie'
        ? (data['title'] as string | undefined)
        : (data['name'] as string | undefined);
    if (!title) return null;
    const date =
      kind === 'movie'
        ? (data['release_date'] as string | undefined)
        : (data['first_air_date'] as string | undefined);
    const runtime =
      kind === 'movie'
        ? (data['runtime'] as number | undefined)
        : (data['episode_run_time'] as number[] | undefined)?.[0];
    const genres = Array.isArray(data['genres'])
      ? (data['genres'] as { name?: unknown }[])
          .map((genre) => genre.name)
          .filter((name): name is string => typeof name === 'string')
      : [];
    const rating = data['vote_average'];
    const votes = data['vote_count'];
    const overview = data['overview'];
    const out: TmdbTitle = {
      title,
      genres,
      image: imageOf(data['poster_path'], 'w500'),
      backdrop: imageOf(data['backdrop_path'], 'w1280'),
      year: typeof date === 'string' && date.length >= 4 ? date.slice(0, 4) : undefined,
      rating: typeof rating === 'number' ? rating : undefined,
      votes: typeof votes === 'number' ? votes : undefined,
      description: typeof overview === 'string' && overview.length > 0 ? overview : undefined,
      durationSec: typeof runtime === 'number' && runtime > 0 ? Math.round(runtime * 60) : undefined,
    };
    if (cache.size > 100) cache.clear();
    cache.set(cacheKey, out);
    return out;
  } catch (err) {
    logError('Movies', `tmdb title ${kind}/${tmdbId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function fetchCredits(kind: MovieKind, tmdbId: string): Promise<TmdbCredits | null> {
  const cacheKey = `${kind}/${tmdbId}`;
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    return hit && 'cast' in hit ? hit : null;
  }
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
