import type { VideoInfo, Format } from '@shared/schemas/media.schema.js';
import { gatedFetch } from '../net';

const SPOTIFY_TRACK_RE = /\/(?:track|podcast\/episode)\/?([A-Za-z0-9]+)/u;

interface SpotifyMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  durationMs: number;
  isrc?: string;
}

export function parseTrackId(url: string): string | null {
  const match = url.match(SPOTIFY_TRACK_RE);
  return match ? match[1] : null;
}

async function fetchText(url: string): Promise<string> {
  const res = await gatedFetch(url);
  if (!res.ok) throw new Error(`Spotify fetch failed: ${res.status} ${url}`);
  return res.text();
}

export async function fetchSpotifyMeta(
  url: string,
  proxyBase: string
): Promise<SpotifyMeta | null> {
  const id = parseTrackId(url);
  if (!id) return null;
  const embedUrl = `https://open.spotify.com/embed/track/${id}`;
  const proxied = `${proxyBase}/proxy?u=${encodeURIComponent(embedUrl)}`;
  const html = await fetchText(proxied);

  const titleMatch = html.match(/data-testid="entity-name"[^>]*>([^<]+)</u);
  const artistMatch = html.match(
    /aria-label="Artist:"[^>]*>\s*<span[^>]*>([^<]+)</u
  );
  const albumMatch = html.match(
    /aria-label="Album:"[^>]*>\s*<span[^>]*>([^<]+)</u
  );
  const durationMatch = html.match(/"totalDurationMs"\s*:\s*(\d+)/u);
  const coverMatch = html.match(/"image"\s*:\s*"([^"]+)"/u);
  const isrcMatch = html.match(/"isrc"\s*:\s*"([^"]+)"/u);

  const titleFallback = html.match(/<title[^>]*>([^<]+)<\/title>/u);
  const title = titleMatch
    ? titleMatch[1].trim()
    : titleFallback
      ? titleFallback[1].split(' - ')[0].trim()
      : null;

  if (!title) return null;

  return {
    id,
    title,
    artist: artistMatch ? artistMatch[1].trim() : '',
    album: albumMatch ? albumMatch[1].trim() : undefined,
    cover: coverMatch ? coverMatch[1] : undefined,
    durationMs: durationMatch ? Number(durationMatch[1]) : 0,
    isrc: isrcMatch ? isrcMatch[1] : undefined,
  };
}

export async function fetchOdesli(
  spotifyUrl: string,
  proxyBase: string
): Promise<{ youtubeUrl?: string } | null> {
  const endpoint = `${proxyBase}/proxy?u=${encodeURIComponent(
    `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyUrl)}`
  )}`;
  const res = await gatedFetch(endpoint);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const ytLink = data?.links?.['youtube.com']?.url;
  if (!ytLink) return null;
  const match = ytLink.match(/\/watch\?v=([A-Za-z0-9_-]+)/u);
  if (!match) return null;
  return { youtubeUrl: `https://www.youtube.com/watch?v=${match[1]}` };
}

export async function resolveViaYoutube(
  meta: SpotifyMeta,
  proxyBase: string,
  resolveYoutube: (
    url: string,
    proxyBase: string
  ) => Promise<{ formats: Format[]; audioUrl?: string } | null>
): Promise<{ formats: Format[]; audioUrl?: string } | null> {
  const odesli = await fetchOdesli(
    `https://open.spotify.com/track/${meta.id}`,
    proxyBase
  );
  if (odesli?.youtubeUrl) {
    return resolveYoutube(odesli.youtubeUrl, proxyBase);
  }
  const query = `${meta.artist} ${meta.title}`.trim();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.replace(/[^a-zA-Z0-9 ]/g, ' '))}`;
  const html = await fetchText(
    `${proxyBase}/proxy?u=${encodeURIComponent(searchUrl)}`
  );
  const videoMatch = html.match(/\/watch\?v=([A-Za-z0-9_-]{11})/u);
  if (!videoMatch) return null;
  const ytUrl = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
  return resolveYoutube(ytUrl, proxyBase);
}

export function partialFromMeta(
  meta: SpotifyMeta,
  url: string
): Pick<
  VideoInfo,
  | 'id'
  | 'type'
  | 'title'
  | 'artist'
  | 'uploader'
  | 'webpageUrl'
  | 'thumbnail'
  | 'duration'
  | 'extractorKey'
  | 'isPartial'
> {
  return {
    id: meta.id,
    type: 'video',
    title: meta.title,
    artist: meta.artist,
    uploader: meta.artist || 'Spotify',
    webpageUrl: url,
    thumbnail: meta.cover,
    duration:
      meta.durationMs > 0 ? Math.round(meta.durationMs / 1000) : undefined,
    extractorKey: 'spotify',
    isPartial: true,
  };
}
