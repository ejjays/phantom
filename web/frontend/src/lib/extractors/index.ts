import type { VideoInfo, Format } from '@shared/schemas/media.schema.js';
import { extractYouTube, createProxyFetch, setProxyFetch } from './youtube';
import {
  fetchSpotifyMeta,
  resolveViaYoutube,
  partialFromMeta,
} from './spotify';
import { extractX } from './x';

export type OnPartial = (info: Partial<VideoInfo>) => void;

let proxyBase = '';

export function initializeResolver(base: string): void {
  proxyBase = base;
  setProxyFetch(createProxyFetch({ proxyBase }));
}

function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com')
    );
  } catch {
    return false;
  }
}

function isSpotify(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'open.spotify.com' ||
      host === 'spotify.com' ||
      host.endsWith('.spotify.com')
    );
  } catch {
    return false;
  }
}

function isTwitter(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'x.com' ||
      host === 'twitter.com' ||
      host.endsWith('.x.com') ||
      host.endsWith('.twitter.com')
    );
  } catch {
    return false;
  }
}

function resolveTwitter(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  return extractX(url, (meta) => {
    onPartial?.({
      id: meta.id,
      type: 'video',
      title: meta.title || '',
      artist: meta.artist,
      webpageUrl: url,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
    });
  });
}

function resolveYouTube(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  return extractYouTube(url, (meta) => {
    onPartial?.({
      id: meta.id,
      type: 'video',
      title: meta.title || '',
      artist: meta.author,
      webpageUrl: url,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
    });
  });
}

async function resolveSpotify(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  const meta = await fetchSpotifyMeta(url, proxyBase);
  if (!meta) return null;

  onPartial?.(partialFromMeta(meta, url));

  const fromYt = await resolveViaYoutube(
    meta,
    proxyBase,
    async (ytUrl: string) => {
      const info = await extractYouTube(ytUrl);
      if (!info) return null;
      const best = info.audioFormats?.[0] ?? info.formats?.[0];
      if (!best) return null;
      return { formats: info.formats, audioUrl: best.url };
    }
  );

  if (fromYt?.formats || fromYt?.audioUrl) {
    const audioFormat: Format | undefined = fromYt.audioUrl
      ? {
          formatId: 'audio',
          url: fromYt.audioUrl,
          extension: 'mp4',
          quality: 'Original',
          isAudio: true,
          isVideo: false,
          isMuxed: false,
          acodec: 'aac',
          tbr: 128,
        }
      : undefined;
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
      formats: fromYt.formats || [],
      audioFormats: audioFormat ? [audioFormat] : [],
      extractorKey: 'spotify',
      isJsInfo: true,
      isPartial: false,
      isIsrcMatch: Boolean(meta.isrc),
      isFullData: true,
      fromBrain: false,
    };
  }

  return {
    ...partialFromMeta(meta, url),
    type: 'video',
    formats: [],
    audioFormats: [],
    isJsInfo: false,
    isPartial: false,
    isIsrcMatch: Boolean(meta.isrc),
    isFullData: true,
    fromBrain: false,
  };
}

export function resolve(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  const cleaned = url.trim();
  if (isYouTube(cleaned)) return resolveYouTube(cleaned, onPartial);
  if (isSpotify(cleaned)) return resolveSpotify(cleaned, onPartial);
  if (isTwitter(cleaned)) return resolveTwitter(cleaned, onPartial);
  return Promise.resolve(null);
}
