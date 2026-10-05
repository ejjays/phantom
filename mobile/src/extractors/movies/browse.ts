import { gatedFetch } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { LUNA_BASE, LUNA_HOSTS } from './constants';
import { parseMovieDetails, type MovieDetails } from './parse';

export type MovieKind = 'movie' | 'tv';

export type MovieItem = {
  id: string;
  kind: MovieKind;
  title: string;
  year?: string;
  poster?: string;
  rating?: number;
};

export type MovieRail = {
  title: string;
  items: MovieItem[];
  page: number;
  totalPages: number;
};

export type MovieTitle = MovieDetails & { id: string; kind: MovieKind };

const TMDB_IMG = 'https://image.tmdb.org/t/p';
const HEADERS = { 'User-Agent': DESKTOP_UA };

function origins(): string[] {
  const bases = [LUNA_BASE, ...LUNA_HOSTS.map((host) => `https://${host}`)];
  return [...new Set(bases)];
}

async function fetchMoviePage(path: string): Promise<{ text: string; origin: string } | null> {
  for (const origin of origins()) {
    try {
      const res = await gatedFetch(`${origin}${path}`, { headers: HEADERS });
      if (res.ok) return { text: await res.text(), origin };
    } catch {
      continue;
    }
  }
  return null;
}

function posterOf(path: unknown, size = 'w342'): string | undefined {
  return typeof path === 'string' && path.startsWith('/')
    ? `${TMDB_IMG}/${size}${path}`
    : undefined;
}

function yearOf(date: unknown): string | undefined {
  return typeof date === 'string' && date.length >= 4 ? date.slice(0, 4) : undefined;
}

export async function searchTitles(query: string): Promise<MovieItem[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  let data: unknown = null;
  for (const origin of origins()) {
    try {
      const res = await gatedFetch(`${origin}/api/search?q=${encodeURIComponent(term)}`, {
        headers: HEADERS,
      });
      if (!res.ok) continue;
      data = (await res.json()) as unknown;
      break;
    } catch {
      continue;
    }
  }
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: MovieItem[] = [];
  for (const entry of results) {
    const rec = entry as Record<string, unknown>;
    const id = rec['id'];
    const title = rec['title'] ?? rec['name'];
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof title !== 'string') continue;
    out.push({
      id: String(id),
      kind: rec['media_type'] === 'tv' ? 'tv' : 'movie',
      title,
      year: yearOf(rec['release_date'] ?? rec['first_air_date']),
      poster: posterOf(rec['poster_path']),
      rating: typeof rec['vote_average'] === 'number' ? rec['vote_average'] : undefined,
    });
  }
  return out;
}

const CARD_RE =
  /<a href="\/(movie|tv)\/(\d+)" class="card">[\s\S]*?<img src="([^"]+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<span class="text-zinc-500">(\d{4})<\/span>/gu;

export function parseCards(html: string): MovieItem[] {
  const out: MovieItem[] = [];
  for (const hit of html.matchAll(CARD_RE)) {
    out.push({
      kind: hit[1] as MovieKind,
      id: hit[2],
      poster: hit[3],
      title: hit[4].trim(),
      year: hit[5],
    });
  }
  return out;
}

function totalPagesOf(html: string): number {
  const pages = html.match(/Page \d+ of (\d+)/u)?.[1];
  const total = pages ? Number(pages) : 1;
  return Number.isFinite(total) && total > 0 ? total : 1;
}

export async function listRail(
  path: string,
  page = 1,
  title = 'Movies'
): Promise<MovieRail | null> {
  const sep = path.includes('?') ? '&' : '?';
  const target = `${path}${sep}page=${page}`;
  const alt = page === 1 ? path : null;
  for (const suffix of [target, ...(alt ? [alt] : [])]) {
    const fetched = await fetchMoviePage(suffix);
    if (!fetched) continue;
    const items = parseCards(fetched.text);
    if (items.length === 0) continue;
    return { title, items, page, totalPages: totalPagesOf(fetched.text) };
  }
  return null;
}

export async function listTrending(): Promise<MovieItem[] | null> {
  const fetched = await fetchMoviePage('/');
  if (!fetched) return null;
  const lists = [...fetched.text.matchAll(
    /<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"ItemList"[\s\S]*?)<\/script>/gu
  )];
  for (const hit of lists) {
    try {
      const list = JSON.parse(hit[1]) as {
        itemListElement?: { url?: string; name?: string; image?: string }[];
      };
      const items: MovieItem[] = [];
      for (const entry of list.itemListElement ?? []) {
        const found = entry.url?.match(/\/(movie|tv)\/(\d+)/u);
        if (!found || typeof entry.name !== 'string') continue;
        items.push({
          kind: found[1] as MovieKind,
          id: found[2],
          title: entry.name,
          poster: entry.image,
        });
      }
      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  return parseCards(fetched.text).slice(0, 10);
}

export async function getTitleDetails(kind: MovieKind, id: string): Promise<MovieTitle | null> {
  const fetched = await fetchMoviePage(`/${kind}/${id}`);
  if (!fetched) return null;
  return { id, kind, ...parseMovieDetails(fetched.text, id) };
}
