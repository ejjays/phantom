import { LUNA_HOSTS } from './constants';

export type LunaRef =
  | { kind: 'movie'; tmdbId: string }
  | { kind: 'tv'; tmdbId: string; season: string; episode: string };

export function isLunaHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^www\./u, '');
  return LUNA_HOSTS.some((d) => bare === d || bare.endsWith(`.${d}`));
}

function digits(value: string | undefined): string | null {
  return value && /^\d+$/u.test(value) ? value : null;
}

export function parseWatchlunaUrl(url: string): LunaRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isLunaHost(parsed.hostname)) return null;
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

export type LunaMeta = {
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

function ldMovie(html: string): Partial<LunaMeta> {
  const out: Partial<LunaMeta> = {};
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
        const graph = rec['@graph'];
        const list = Array.isArray(graph) ? (graph as Record<string, unknown>[]) : [rec];
        for (const item of list) {
          if (item['@type'] !== 'Movie' && item['@type'] !== 'TVSeries' && item['@type'] !== 'VideoObject') continue;
          if (typeof item['name'] === 'string' && !out.title) out.title = decodeEntities(item['name']);
          const img = item['image'];
          if (!out.image) {
            if (typeof img === 'string') out.image = img;
            else if (Array.isArray(img) && typeof img[0] === 'string') out.image = img[0] as string;
          }
          if (typeof item['description'] === 'string' && !out.description) {
            out.description = decodeEntities(item['description']);
          }
          if (typeof item['duration'] === 'string' && !out.durationSec) {
            const dur = (item['duration'] as string).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/u);
            if (dur) {
              out.durationSec =
                Number(dur[1] ?? 0) * 3600 + Number(dur[2] ?? 0) * 60 + Number(dur[3] ?? 0);
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

export function parseLunaMeta(html: string, fallbackId: string): LunaMeta {
  const ld = ldMovie(html);
  const ogTitle = metaContent(html, 'og:title');
  const titleRaw = html.match(/<title>([^<]+)<\/title>/iu)?.[1];
  const title =
    ld.title ??
    (ogTitle ? ogTitle.split('|')[0].trim() : undefined) ??
    (titleRaw ? decodeEntities(titleRaw).split('|')[0].trim() : undefined) ??
    `Watchluna ${fallbackId}`;
  const image = ld.image ?? metaContent(html, 'og:image');
  return { title, image, durationSec: ld.durationSec, description: ld.description };
}
