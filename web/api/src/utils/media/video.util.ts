import { spawn } from 'node:child_process';
import { logger } from '../infra/logger.util.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHost } from '../network/host.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const normalizeUrl = (url: string): string => {
  if (!url) return '';
  let normalized = url.trim();

  // clean mobile prefix
  normalized = normalized.replace(/^(?:https?:\/\/)?m\./u, 'https://');

  // handle short urls
  if (normalized.includes('youtu.be/')) {
    const id = normalized.split('youtu.be/')[1].split(/[?#]/u)[0];
    return `https://www.youtube.com/watch?v=${id}`;
  }

  // strip tracking
  try {
    const parsed = new URL(normalized);
    const trackingParams = ['si', 'context', 'fbclid', 'rdid', 'utm_source'];
    trackingParams.forEach((param) => {
      parsed.searchParams.delete(param);
    });
    normalized = parsed.toString();
  } catch (_ERR) {
    // parse failed
    logger.debug('[URL Normalization] Failed to parse URL:', _ERR);
  }

  return normalized;
};

export const detectService = (url: string): string => {
  const normalized = url.toLowerCase();
  if (isHost(normalized, 'youtube.com') || isHost(normalized, 'youtu.be'))
    return 'YouTube';
  if (isHost(normalized, 'facebook.com') || isHost(normalized, 'fb.watch'))
    return 'Facebook';
  if (isHost(normalized, 'instagram.com')) return 'Instagram';
  if (isHost(normalized, 'tiktok.com')) return 'TikTok';
  if (isHost(normalized, 'spotify.com')) return 'Spotify';
  if (isHost(normalized, 'soundcloud.com')) return 'SoundCloud';
  if (
    isHost(normalized, 'bilibili.tv') ||
    isHost(normalized, 'biliintl.com') ||
    isHost(normalized, 'bili.im')
  )
    return 'Bilibili';
  return 'Generic';
};

export const getCookieType = (url: string): string | null => {
  const service = detectService(url);
  if (service === 'YouTube') return 'youtube';
  if (service === 'Facebook' || service === 'Instagram') return 'facebook';
  return null;
};

export const getSanitizedFilename = (
  title: string,
  artist: string | undefined,
  format: string,
  isSpotifyRequest = false
): string => {
  let displayTitle = title;
  if (isSpotifyRequest && artist) displayTitle = `${artist} - ${displayTitle}`;

  // clean punctuation
  let sanitized = displayTitle
    .replace(/[<>:"/|?*]/gu, '') // illegal chars
    .replace(/[\r\n\t]+/gu, ' ') // newlines
    .replace(/\s+/gu, ' ') // collapse spaces
    .trim();

  // truncate titles
  const maxLength = 64;
  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.substring(0, maxLength).trim()}...`;
  }

  return `${sanitized || 'video'}.${format}`;
};

export function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const processInstance = spawn('ffmpeg', ['-version']);
    processInstance.on('error', () => resolve(false));
    processInstance.on('close', (code) => resolve(code === 0));
  });
}
