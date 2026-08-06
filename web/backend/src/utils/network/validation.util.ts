import { URL } from 'node:url';
import { logger } from '../infra/logger.util.js';

const SUPPORTED_DOMAINS: string[] = [
  'youtube.com',
  'youtu.be',
  'spotify.com',
  'open.spotify.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'threads.net',
  'threads.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'soundcloud.com',
  'reddit.com',
  'bsky.app',
  'bilibili.tv',
  'biliintl.com',
  'bili.im',
];

export function isSupportedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return SUPPORTED_DOMAINS.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export function isValidSpotifyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'open.spotify.com' ||
      parsed.hostname === 'spotify.com'
    );
  } catch {
    return false;
  }
}

export function extractTrackId(url: string | null | undefined): string | null {
  if (!url || !isValidSpotifyUrl(url)) return null;
  const match = url.match(/\/track\/([a-zA-Z0-9]{22})/);
  return match ? match[1] : null;
}

const PROXY_ALLOWED_DOMAINS: string[] = [
  'googlevideo.com',
  'youtube.com',
  'youtu.be',
  'spotifycdn.com',
  'soundcharts.com',
  'i.scdn.co',
  'fbcdn.net',
  'cdninstagram.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'akamaihd.net',
  'bilibili.tv',
  'biliintl.com',
  'bili.im',
  'bilivideo.com',
  'bstarstatic.com',
];

export function isValidProxyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return PROXY_ALLOWED_DOMAINS.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export function decodeUrlIfNeeded(url: string): string {
  if (typeof url !== 'string' || !url.includes('%')) return url;
  try {
    const decoded = decodeURIComponent(url);
    if (decoded.startsWith('http')) return decoded;
  } catch (error: unknown) {
    logger.debug(
      '[VideoController] URL decode error:',
      (error as Error).message
    );
  }
  return url;
}
