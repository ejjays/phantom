// local stream URL resolver; replaces /stream-urls backend call
import type { VideoInfo } from '@shared/schemas/media.schema.js';
import { useRemixStore } from '../store/useRemixStore';
import { PROXY_BASE } from './config';

export interface StreamUrlsResponse {
  videoUrl?: string;
  audioUrl?: string;
  directUrl?: string;
}

const cache = new Map<string, StreamUrlsResponse>();
const cacheTs = new Map<string, number>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const cleanPageUrl = (pageUrl: string) =>
  pageUrl.split('&id=')[0].split('?id=')[0];

const makeKey = (
  pageUrl: string,
  formatId: string,
  full = false,
  audioLang?: string
) =>
  `${cleanPageUrl(pageUrl)}::${formatId}::${full ? 'full' : 'fast'}::${audioLang || 'orig'}`;

function proxyIfNeeded(rawUrl: string): string {
  try {
    const { hostname } = new URL(rawUrl);
    if (
      hostname.endsWith('googlevideo.com') ||
      hostname.endsWith('youtube.com') ||
      hostname.endsWith('ytimg.com')
    ) {
      return `${PROXY_BASE}/proxy?u=${encodeURIComponent(rawUrl)}`;
    }
  } catch {
    // not a url
  }
  return rawUrl;
}

function splitVideoAudio(
  info: VideoInfo | null,
  formatId: string
): StreamUrlsResponse {
  const allFormats = [...(info?.formats || []), ...(info?.audioFormats || [])];
  const fmt = allFormats.find((f) => String(f.formatId) === String(formatId));
  if (fmt?.url) {
    const direct = proxyIfNeeded(fmt.url);
    if (direct) return { directUrl: direct };
  }
  const videoFmt = allFormats.find(
    (f) => f.isVideo && !f.isAudio && String(f.formatId) === String(formatId)
  );
  const audioFmt = allFormats.find((f) => f.isAudio && !f.isVideo);
  return {
    videoUrl: videoFmt ? proxyIfNeeded(videoFmt.url || '') : undefined,
    audioUrl: audioFmt ? proxyIfNeeded(audioFmt.url || '') : undefined,
  };
}

export function resolveStreamUrls(
  _backendUrl: string,
  pageUrl: string,
  formatId: string,
  _clientId?: string,
  full = false,
  audioLang?: string
): Promise<StreamUrlsResponse> {
  const key = makeKey(pageUrl, formatId, full, audioLang);
  const cached = cache.get(key);
  if (cached && Date.now() - (cacheTs.get(key) ?? 0) < CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }
  const info = useRemixStore.getState().videoData;
  const result = splitVideoAudio(info, formatId);
  cache.set(key, result);
  cacheTs.set(key, Date.now());
  return Promise.resolve(result);
}

export function prefetchStreamUrls(
  _backendUrl: string,
  _pageUrl: string | undefined,
  _formatId: string | undefined,
  _clientId: string | undefined
): void {}

export function clearPreviewCache(): void {
  cache.clear();
  cacheTs.clear();
}
