import { LUNA_HOSTS } from './constants';

export type MovieRef =
  | { kind: 'movie'; tmdbId: string }
  | { kind: 'tv'; tmdbId: string; season: string; episode: string };

export function isMovieHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^www\./u, '');
  return LUNA_HOSTS.some((d) => bare === d || bare.endsWith(`.${d}`));
}

function digits(value: string | undefined): string | null {
  return value && /^\d+$/u.test(value) ? value : null;
}

export function parseMovieUrl(url: string): MovieRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isMovieHost(parsed.hostname)) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (parts.length >= 2 && (parts[0] === 'movie' || parts[0] === 'watch')) {
    if (parts[0] === 'watch' && parts[1] !== 'movie' && parts[1] !== 'tv') return null;
    if (parts[0] === 'watch' && parts[1] === 'movie') {
      const id = digits(parts[2]);
      return id ? { kind: 'movie', tmdbId: id } : null;
    }
    if (parts[0] === 'watch' && parts[1] === 'tv') {
      const id = digits(parts[2]);
      if (!id) return null;
      return { kind: 'tv', tmdbId: id, season: parts[3] ?? '1', episode: parts[4] ?? '1' };
    }
    if (parts[0] === 'movie') {
      const id = digits(parts[1]);
      return id ? { kind: 'movie', tmdbId: id } : null;
    }
  }
  if (parts.length >= 2 && parts[0] === 'tv') {
    const id = digits(parts[1]);
    if (!id) return null;
    return { kind: 'tv', tmdbId: id, season: parts[2] ?? '1', episode: parts[3] ?? '1' };
  }

  const tail = parts[parts.length - 1] ?? '';
  const legacy = tail.match(/-(\d+)$/u)?.[1];
  if (legacy) {
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/tv') || path.includes('/show') || path.includes('/series')) {
      return { kind: 'tv', tmdbId: legacy, season: '1', episode: '1' };
    }
    return { kind: 'movie', tmdbId: legacy };
  }
  return null;
}

export type MovieMeta = {
  title: string;
  image?: string;
  durationSec?: number;
  description?: string;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&amp;/giu, '&');
}

function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    'iu'
  );
  const found = html.match(re);
  return found ? decodeEntities(found[1] ?? found[2] ?? '') : undefined;
}

function parseIsoDuration(raw: string): number | undefined {
  const dur = raw.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/u);
  if (!dur) return undefined;
  return Number(dur[1] ?? 0) * 3600 + Number(dur[2] ?? 0) * 60 + Number(dur[3] ?? 0);
}

function movieNode(html: string): Record<string, unknown> | null {
  for (const hit of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu
  )) {
    const raw = hit[1] ?? '';
    if (!raw.includes('"Movie"') && !raw.includes('"TVSeries"') && !raw.includes('"VideoObject"')) continue;
    try {
      const json: unknown = JSON.parse(raw);
      const graph = (json as { '@graph'?: unknown })['@graph'];
      const nodes = Array.isArray(graph) ? (graph as unknown[]) : [json];
      for (const node of nodes) {
        const rec = node as Record<string, unknown>;
        const inner = rec['@graph'];
        const list = Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [rec];
        for (const item of list) {
          if (item['@type'] === 'Movie' || item['@type'] === 'TVSeries' || item['@type'] === 'VideoObject') {
            return item;
          }
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export type MovieDetails = {
  title: string;
  image?: string;
  backdrop?: string;
  durationSec?: number;
  description?: string;
  year?: string;
  rating?: number;
  votes?: number;
  genres: string[];
  contentRating?: string;
  director?: string;
  cast: string[];
  castPhotos?: Record<string, string>;
  directorPhoto?: string;
};

function personName(value: unknown): string | undefined {
  if (typeof value === 'string') return decodeEntities(value);
  const rec = value as Record<string, unknown> | null;
  return typeof rec?.['name'] === 'string' ? decodeEntities(rec['name']) : undefined;
}

export function parseMovieDetails(html: string, fallbackId: string): MovieDetails {
  const meta = parseMovieMeta(html, fallbackId);
  const node = movieNode(html);
  const date = typeof node?.['datePublished'] === 'string' ? node['datePublished'] : undefined;
  const agg = node?.['aggregateRating'] as Record<string, unknown> | undefined;
  const rawGenres = node?.['genre'];
  const rawCast = node?.['actor'];
  const backdrop = html.match(
    /<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+href=["']([^"']+)["']/iu
  )?.[1];
  return {
    ...meta,
    year: date?.slice(0, 4),
    rating: typeof agg?.['ratingValue'] === 'number' ? agg['ratingValue'] : undefined,
    votes: typeof agg?.['ratingCount'] === 'number' ? agg['ratingCount'] : undefined,
    genres: Array.isArray(rawGenres)
      ? rawGenres.filter((genre): genre is string => typeof genre === 'string')
      : [],
    contentRating: typeof node?.['contentRating'] === 'string' ? node['contentRating'] : undefined,
    director: personName(node?.['director']),
    cast: Array.isArray(rawCast)
      ? rawCast.map(personName).filter((name): name is string => Boolean(name)).slice(0, 8)
      : [],
    backdrop,
  };
}

function ldMovie(html: string): Partial<MovieMeta> {
  const out: Partial<MovieMeta> = {};
  const node = movieNode(html);
  if (!node) return out;
  if (typeof node['name'] === 'string') out.title = decodeEntities(node['name']);
  const img = node['image'];
  if (typeof img === 'string') out.image = img;
  else if (Array.isArray(img) && typeof img[0] === 'string') out.image = img[0] as string;
  if (typeof node['description'] === 'string') {
    out.description = decodeEntities(node['description']);
  }
  if (typeof node['duration'] === 'string') {
    out.durationSec = parseIsoDuration(node['duration']);
  }
  return out;
}

export function parseMovieMeta(html: string, fallbackId: string): MovieMeta {
  const ld = ldMovie(html);
  const ogTitle = metaContent(html, 'og:title');
  const titleRaw = html.match(/<title>([^<]+)<\/title>/iu)?.[1];
  const title =
    ld.title ??
    (ogTitle ? ogTitle.split('|')[0].trim() : undefined) ??
    (titleRaw ? decodeEntities(titleRaw).split('|')[0].trim() : undefined) ??
    `Phantom ${fallbackId}`;
  const image = ld.image ?? metaContent(html, 'og:image');
  return { title, image, durationSec: ld.durationSec, description: ld.description };
}
