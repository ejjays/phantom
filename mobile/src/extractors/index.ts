import { VideoInfo, Format, ExtractorError } from './shared/types';
import { getInfo as facebookGetInfo } from './facebook';
import { getInfo as tiktokGetInfo } from './tiktok';
import { getInfo as threadsGetInfo } from './threads';
import { getInfo as youtubeGetInfo } from './youtube';
import { getInfo as bilibiliGetInfo } from './bilibili';
import { getInfo as instagramGetInfo } from './instagram';
import { getInfo as spotifyGetInfo } from './spotify';
import { getInfo as soundcloudGetInfo } from './soundcloud';
import { getInfo as redditGetInfo } from './reddit';
import { getInfo as dailymotionGetInfo } from './dailymotion';
import { getInfo as pinterestGetInfo } from './pinterest';
import { getInfo as twitchGetInfo } from './twitch';
import { getInfo as snapchatGetInfo } from './snapchat';
import { getCachedInfo, setCachedInfo } from '../lib/cache';
import { reportError } from '../lib/crash';
import { log } from '../lib/log';
import { mapLimit } from '../lib/net';
import { getGenericSnifferEnabled } from '../lib/settings';
import { extractFromPage } from '../lib/webviewExtraction/host';
import { pageScanToVideoInfo } from '../lib/webviewExtraction/normalize';
import { probeFileSize } from './shared/utils';
import { getExtractor as pkgGetExtractor } from '@phantom/extractors';
import { mobileSharedEnvWithThumbs } from './shared/env';

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

  if (matches(host, 'soundcloud.com')) {
    return soundcloudGetInfo(url, onPartial);
  }

  // shared pkg handles reddit/dailymotion/pinterest/twitch/snapchat
  // but keep explicit imports for typed error + single source
  if (matches(host, 'reddit.com') || matches(host, 'redd.it')) {
    return redditGetInfo(url);
  }
  if (matches(host, 'dailymotion.com') || matches(host, 'dai.ly')) {
    return dailymotionGetInfo(url);
  }
  if (matches(host, 'pin.it') || /(?:^|\.)pinterest\.(?:[a-z]{2,4}|com?\.[a-z]{2})$/u.test(host)) {
    return pinterestGetInfo(url);
  }
  if (matches(host, 'twitch.tv') || matches(host, 'clip.twitch.tv')) {
    return twitchGetInfo(url, onPartial as unknown as never);
  }
  if (matches(host, 'snapchat.com') || matches(host, 't.snapchat.com') || matches(host, 'story.snapchat.com')) {
    return snapchatGetInfo(url);
  }

  const pkg = pkgGetExtractor(url, mobileSharedEnvWithThumbs);
  if (pkg) return pkg.getInfo(url) as Promise<VideoInfo | null>;

  return Promise.resolve(null);
}

const FAST_RESOLVE_DISABLED =
  process.env.EXPO_PUBLIC_DISABLE_FAST_RESOLVE === '1';

// native paths win for these (PO-token, audio-only) — skip the webview scan
const WEBVIEW_GUARDED = [
  'youtube.com',
  'youtu.be',
  'spotify.com',
  'soundcloud.com',
];

function webviewGuarded(host: string): boolean {
  return WEBVIEW_GUARDED.some((domain) => matches(host, domain));
}

// expected fails (private/removed/geo/login) & client drops aren't our bug
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
  onPartial?: OnPartial,
  options?: { fresh?: boolean }
): Promise<VideoInfo | null> {
  const host = hostOf(url);

  if (!FAST_RESOLVE_DISABLED && !options?.fresh) {
    const cached = getCachedInfo(url);
    if (cached) return cached;
  }

  const partialSink = FAST_RESOLVE_DISABLED ? undefined : onPartial;

  let info: VideoInfo | null = null;
  let originalError: unknown = null;
  try {
    info = await dispatch(host, url, partialSink);
  } catch (error) {
    originalError = error;
    if (webviewGuarded(host) || !(error instanceof ExtractorError)) {
      reportFailure(host, error);
      throw error;
    }
  }

  // generic webview DOM scan; opt-in flag, 30s scan that finds nothing > instant fail
  if (!info && !webviewGuarded(host) && !(await getGenericSnifferEnabled())) {
    if (originalError !== null) {
      reportFailure(host, originalError);
      throw originalError;
    }
    return null;
  }

  if (!info && !webviewGuarded(host)) {
    log(
      'Resolve',
      'webview fallback',
      url,
      originalError ? `after error: ${originalError}` : '(unknown host)'
    );
    const scan = await extractFromPage(url, (scan) => {
      const partial = pageScanToVideoInfo(scan, host, true);
      if (partial) partialSink?.(partial);
    });
    info = scan ? pageScanToVideoInfo(scan, host, false) : null;
    if (info && !info.isPartial && info.formats.length > 0) {
      const headers = info.downloadHeaders ?? {};
      await mapLimit(info.formats, 2, async (format) => {
        if (!format.url || format.filesize || format.isHls) return;
        const size = await probeFileSize(format.url, headers);
        if (size) format.filesize = size;
      });
      const sizeLabel = (format: Format): string =>
        format.filesize
          ? `${Math.round(format.filesize / 1024 / 1024)}MB`
          : '?size';
      log(
        'Resolve',
        'webview info',
        info.title,
        '|',
        info.formats.map(
          (format) => `${format.extension} ${sizeLabel(format)} @ ${format.url}`
        )
      );
    }
    if (!info && originalError !== null) {
      reportFailure(host, originalError);
      throw originalError;
    }
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
