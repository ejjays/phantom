import { VideoInfo, ExtractorError } from './types';
import { getInfo as facebookGetInfo } from './facebook';
import { getInfo as tiktokGetInfo } from './tiktok';
import { getInfo as xGetInfo } from './x';
import { getInfo as threadsGetInfo } from './threads';
import { getInfo as youtubeGetInfo } from './youtube';
import { getInfo as bilibiliGetInfo } from './bilibili';
import { getInfo as instagramGetInfo } from './instagram';
import { getInfo as spotifyGetInfo } from './spotify';
import { getInfo as blueskyGetInfo } from './bluesky';
import { getInfo as redditGetInfo } from './reddit';
import { getInfo as soundcloudGetInfo } from './soundcloud';
import { getInfo as vimeoGetInfo } from './vimeo';
import { getInfo as dailymotionGetInfo } from './dailymotion';
import { getInfo as pinterestGetInfo } from './pinterest';
import { getInfo as twitchGetInfo } from './twitch';
import { getCachedInfo, setCachedInfo } from '../lib/cache';
import { reportError } from '../lib/crash';

export type OnPartial = (info: VideoInfo) => void;

function hostOf(url: string): string {
  const cleaned = url.replace(/^https?:\/\//iu, '');
  return cleaned.split(/[/?#]/u)[0].toLowerCase();
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function dispatch(
  host: string,
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  if (matches(host, 'youtube.com') || matches(host, 'youtu.be')) {
    return youtubeGetInfo(url, onPartial);
  }

  if (matches(host, 'spotify.com')) {
    return spotifyGetInfo(url, onPartial);
  }

  if (
    matches(host, 'bilibili.tv') ||
    matches(host, 'biliintl.com') ||
    matches(host, 'bili.im')
  ) {
    return bilibiliGetInfo(url);
  }

  if (matches(host, 'tiktok.com')) {
    return tiktokGetInfo(url);
  }

  if (matches(host, 'instagram.com')) {
    return instagramGetInfo(url);
  }

  if (matches(host, 'x.com') || matches(host, 'twitter.com')) {
    return xGetInfo(url);
  }

  if (matches(host, 'threads.net') || matches(host, 'threads.com')) {
    return threadsGetInfo(url);
  }

  if (
    matches(host, 'facebook.com') ||
    matches(host, 'fb.watch') ||
    matches(host, 'fb.com')
  ) {
    return facebookGetInfo(url, onPartial);
  }

  if (matches(host, 'bsky.app')) {
    return blueskyGetInfo(url);
  }

  if (matches(host, 'reddit.com') || matches(host, 'redd.it')) {
    return redditGetInfo(url);
  }

  if (matches(host, 'soundcloud.com')) {
    return soundcloudGetInfo(url, onPartial);
  }

  if (matches(host, 'vimeo.com')) {
    return vimeoGetInfo(url);
  }

  if (matches(host, 'dailymotion.com') || matches(host, 'dai.ly')) {
    return dailymotionGetInfo(url);
  }

  // intl tlds (pinterest.ph, .co.uk, ...) handled inside the extractor
  if (
    matches(host, 'pin.it') ||
    /(?:^|\.)pinterest\.(?:[a-z]{2,4}|com?\.[a-z]{2})$/u.test(host)
  ) {
    return pinterestGetInfo(url);
  }

  if (matches(host, 'twitch.tv')) {
    return twitchGetInfo(url, onPartial);
  }

  return Promise.resolve(null);
}

const FAST_RESOLVE_DISABLED =
  process.env.EXPO_PUBLIC_DISABLE_FAST_RESOLVE === '1';

// benign content-state fails (private/removed/geo/login) & client network drops
// aren't our bug — keep out of sentry so real extractor breaks stand out.
function reportFailure(host: string, error: unknown): void {
  if (error instanceof ExtractorError && error.expected) return;
  reportError(
    error,
    { host },
    {
      kind: 'extractor_failure',
      host,
      retryable: String(error instanceof ExtractorError && error.retryable),
    }
  );
}

export async function resolve(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  const host = hostOf(url);

  if (!FAST_RESOLVE_DISABLED) {
    const cached = getCachedInfo(url);
    if (cached) return cached;
  }

  let info: VideoInfo | null;
  try {
    info = await dispatch(
      host,
      url,
      FAST_RESOLVE_DISABLED ? undefined : onPartial
    );
  } catch (error) {
    reportFailure(host, error);
    throw error;
  }

  if (
    !FAST_RESOLVE_DISABLED &&
    info &&
    !info.isPartial &&
    info.formats.length > 0
  ) {
    setCachedInfo(url, info);
  }
  return info;
}
