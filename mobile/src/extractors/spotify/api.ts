import { gatedFetch } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';

const API_BASE = 'https://api.spotify.com/v1';

export function parseTrackId(url: string): string | null {
  const match = url.match(/track[/:]([A-Za-z0-9]+)/u);
  return match ? match[1] : null;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover?: string;
  durationMs: number;
  isrc?: string;
  previewUrl?: string;
}

interface SpotifyApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
  external_ids: { isrc?: string };
  preview_url?: string | null;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  // dynamic — client secret off-device + node tests react-native-free
  const { supabase } = await import('../../lib/social/supabase');
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke<{
      access_token?: string;
      expires_in?: number;
    }>('spotify-token');
    if (error || !data?.access_token) return null;
    const expiresIn = data.expires_in ?? 3600;
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

export async function fetchSpotifyTrack(
  trackId: string
): Promise<SpotifyTrack | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await gatedFetch(`${API_BASE}/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const track = (await res.json()) as SpotifyApiTrack;
    return {
      id: track.id,
      title: track.name,
      artist: (track.artists || []).map((a) => a.name).join(', '),
      album: track.album?.name || '',
      cover: track.album?.images?.[0]?.url,
      durationMs: track.duration_ms || 0,
      isrc: track.external_ids?.isrc,
      previewUrl: track.preview_url || undefined,
    };
  } catch {
    return null;
  }
}

export interface SpotifyEmbed {
  title?: string;
  artist?: string;
  cover?: string;
  durationMs?: number;
  isrc?: string;
  previewUrl?: string;
}

type EmbedEntity = {
  name?: string;
  title?: string;
  artists?: Array<{ name?: string }>;
  subtitle?: string;
  duration?: number;
  duration_ms?: number;
  isrcCode?: string;
  external_ids?: { isrc?: string };
  coverArt?: { sources?: Array<{ url?: string }> };
  visualIdentity?: { image?: Array<{ url?: string }> };
  thumbnailUrl?: string;
  audioPreview?: { url?: string };
  preview_url?: string;
};

const lastOf = <T>(arr?: T[]): T | undefined =>
  arr && arr.length > 0 ? arr[arr.length - 1] : undefined;

function mapEmbedEntity(entity: EmbedEntity | undefined): SpotifyEmbed | null {
  if (!entity) return null;
  const title = entity.name || entity.title;
  if (!title) return null;
  const artist =
    entity.artists?.[0]?.name ||
    (typeof entity.subtitle === 'string' ? entity.subtitle : undefined);
  const cover =
    lastOf(entity.coverArt?.sources)?.url ||
    lastOf(entity.visualIdentity?.image)?.url ||
    entity.thumbnailUrl;
  return {
    title,
    artist,
    cover,
    durationMs: entity.duration ?? entity.duration_ms ?? 0,
    isrc: entity.isrcCode || entity.external_ids?.isrc,
    previewUrl: entity.audioPreview?.url || entity.preview_url,
  };
}

// embed json sometimes ships url-encoded
function scriptJson(html: string, id: string): unknown {
  const match = html.match(
    new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`, 'u')
  );
  if (!match) return null;
  const raw = match[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
}

export function parseEmbedHtml(html: string): SpotifyEmbed | null {
  const next = scriptJson(html, '__NEXT_DATA__') as {
    props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } };
  } | null;
  const fromNext = mapEmbedEntity(next?.props?.pageProps?.state?.data?.entity);
  if (fromNext) return fromNext;

  const resource = scriptJson(html, 'resource') as EmbedEntity | null;
  return mapEmbedEntity(resource ?? undefined);
}

// instant metadata without spotify credentials or the registry
export async function fetchSpotifyEmbed(
  trackId: string
): Promise<SpotifyEmbed | null> {
  try {
    const res = await gatedFetch(
      `https://open.spotify.com/embed/track/${trackId}`,
      {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (res.ok) {
      const parsed = parseEmbedHtml(await res.text());
      if (parsed?.title) return parsed;
    }
  } catch {
    /* fall back to oembed */
  }
  try {
    const target = encodeURIComponent(
      `https://open.spotify.com/track/${trackId}`
    );
    const res = await gatedFetch(
      `https://open.spotify.com/oembed?url=${target}`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        thumbnail_url?: string;
      };
      if (data.title) return { title: data.title, cover: data.thumbnail_url };
    }
  } catch {
    /* other sources cover it */
  }
  return null;
}

interface OdesliEntity {
  title?: string;
  artistName?: string;
  thumbnailUrl?: string;
  isrc?: string;
}

interface OdesliResponse {
  entityUniqueId?: string;
  entitiesByUniqueId?: Record<string, OdesliEntity>;
  linksByPlatform?: Record<string, { url?: string }>;
}

export interface OdesliResult {
  title?: string;
  artist?: string;
  cover?: string;
  isrc?: string;
  youtubeUrl?: string;
}

export async function fetchOdesli(
  trackId: string
): Promise<OdesliResult | null> {
  try {
    const target = encodeURIComponent(
      `https://open.spotify.com/track/${trackId}`
    );
    const res = await gatedFetch(
      `https://api.song.link/v1-alpha.1/links?url=${target}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as OdesliResponse;
    const entities = data.entitiesByUniqueId ?? {};
    const entity = data.entityUniqueId
      ? entities[data.entityUniqueId]
      : undefined;
    // canonical entity may lack isrc
    const isrc =
      entity?.isrc ?? Object.values(entities).find((item) => item?.isrc)?.isrc;
    const youtubeUrl =
      data.linksByPlatform?.youtube?.url ||
      data.linksByPlatform?.youtubeMusic?.url;
    return {
      title: entity?.title,
      artist: entity?.artistName,
      cover: entity?.thumbnailUrl,
      isrc,
      youtubeUrl,
    };
  } catch {
    return null;
  }
}
