import { isHost } from '../../utils/network/host.util.js';
import {
  getInfo as ytGetInfo,
  getStream as ytGetStream,
} from './youtube/index.js';
import { logger } from '../../utils/infra/logger.util.js';
import {
  getInfo as igGetInfo,
  getStream as igGetStream,
} from './instagram/index.js';
import {
  getInfo as fbGetInfo,
  getStream as fbGetStream,
} from './facebook/index.js';
import { getInfo as tkGetInfo, getStream as tkGetStream } from './tiktok.js';
import { getInfo as spGetInfo, getStream as spGetStream } from './spotify.js';
import {
  getInfo as scGetInfo,
  getStream as scGetStream,
} from './soundcloud.js';
import {
  getInfo as thGetInfo,
  getStream as thGetStream,
} from './threads/index.js';
import { getInfo as biGetInfo, getStream as biGetStream } from './bilibili.js';
import {
  getInfo as genGetInfo,
  getStream as genGetStream,
} from './generic.js';
import { Extractor, ExtractorOptions, VideoInfo } from '../../types/index.js';
import {
  fetchMetadata,
  fetchYoutubeOEmbed,
} from '../../utils/media/metadata.util.js';
import { recordFailure } from '../../utils/infra/metrics.util.js';
import { getExtractor as pkgGetExtractor } from '@phantom/extractors';
import { sharedBackendEnv } from './sharedEnv.js';
import { Readable } from 'node:stream';

const youtube: Extractor = { getInfo: ytGetInfo, getStream: ytGetStream };
const instagram: Extractor = { getInfo: igGetInfo, getStream: igGetStream };
const facebook: Extractor = { getInfo: fbGetInfo, getStream: fbGetStream };
const tiktok: Extractor = { getInfo: tkGetInfo, getStream: tkGetStream };
const spotify: Extractor = { getInfo: spGetInfo, getStream: spGetStream };
const soundcloud: Extractor = { getInfo: scGetInfo, getStream: scGetStream };
const threads: Extractor = { getInfo: thGetInfo, getStream: thGetStream };
const bilibili: Extractor = { getInfo: biGetInfo, getStream: biGetStream };

function wrapPkg(pkg: {
  getInfo: (url: string, options?: ExtractorOptions) => Promise<VideoInfo | null>;
  getStream: (videoInfo: VideoInfo, options?: ExtractorOptions) => Promise<ReadableStream>;
}): Extractor {
  return {
    getInfo: pkg.getInfo,
    getStream: (videoInfo, options) =>
      Promise.resolve(
        Readable.fromWeb(
          pkg.getStream(videoInfo, options) as unknown as import('node:stream/web').ReadableStream
        )
      ),
  };
}

// reverse lookup for failure labels
const extractorNames = new Map<Extractor, string>([
  [youtube, 'youtube'],
  [instagram, 'instagram'],
  [facebook, 'facebook'],
  [tiktok, 'tiktok'],
  [spotify, 'spotify'],
  [soundcloud, 'soundcloud'],
  [threads, 'threads'],
  [bilibili, 'bilibili'],
]);

// map in-flight JS
const inFlightJsTasks = new Map<string, Promise<VideoInfo | null>>();

/**
 * Returns the in-flight (or recently completed) JS extraction promise for a URL.
 * Used by handleYoutubeTiktokInfo to skip yt-dlp deep-scan when JS already has formats.
 */
export function getInFlightJsResult(
  url: string
): Promise<VideoInfo | null> | undefined {
  return inFlightJsTasks.get(url);
}

const genericExtractor: Extractor = {
  // yt-dlp generic: Pure's get_video.dat + onLoadResource in one engine
  getInfo: genGetInfo,
  getStream: genGetStream,
};

function pkgLabel(url: string): string {
  if (isHost(url, 'vimeo.com')) return 'vimeo';
  if (isHost(url, 'bsky.app')) return 'bluesky';
  if (
    isHost(url, 'twitter.com') ||
    /\/\/(?:www\.|mobile\.)?x\.com\//u.test(url)
  )
    return 'x';
  return 'pkg-shared';
}

export function getExtractor(url: string): Extractor | null {
  const pkg = pkgGetExtractor(url, sharedBackendEnv);
  if (pkg) {
    const wrapped = wrapPkg(pkg);
    extractorNames.set(wrapped, pkgLabel(url));
    return wrapped;
  }
  if (isHost(url, 'youtube.com') || isHost(url, 'youtu.be')) return youtube;
  if (isHost(url, 'instagram.com')) return instagram;
  if (isHost(url, 'facebook.com') || isHost(url, 'fb.watch')) return facebook;
  if (isHost(url, 'threads.net') || isHost(url, 'threads.com'))
    return threads;
  if (isHost(url, 'tiktok.com')) return tiktok;
  if (isHost(url, 'spotify.com')) return spotify;
  if (isHost(url, 'soundcloud.com')) return soundcloud;
  if (
    isHost(url, 'bilibili.tv') ||
    isHost(url, 'biliintl.com') ||
    isHost(url, 'bili.im')
  )
    return bilibili;
  return genericExtractor;
}

// platform label, not a real author
function isLowValueEarlyAuthor(name: string | undefined): boolean {
  if (!name) return true;
  const value = name.trim().toLowerCase();
  return [
    'facebook',
    'instagram',
    'threads',
    'tiktok',
    'x',
    'twitter',
    'bluesky',
    'social media',
    'make your day',
    'unknown',
  ].includes(value);
}

export async function getInfo(
  url: string,
  options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  const extractor = getExtractor(url);
  if (!extractor) return null;

  const getInfoStart = Date.now();
  const isYouTube = isHost(url, 'youtube.com') || isHost(url, 'youtu.be');

  const metaFetcher = isYouTube ? fetchYoutubeOEmbed : fetchMetadata;

  const metaFetchStart = Date.now();
  const metascraperTask = metaFetcher(url)
    .catch(() => null)
    .then(async (meta) => {
      const metaFetchMs = Date.now() - metaFetchStart;
      logger.info(
        `[Timing] ${isYouTube ? 'oEmbed' : 'metascraper'} fetch took ${metaFetchMs}ms (returned ${meta ? 'data' : 'null'})`
      );

      if (meta && (meta.author || meta.publisher) && options.onProgress) {
        try {
          const dispatchStart = Date.now();
          const { prepareFinalResponse } =
            await import('../../utils/api/response.util.js');
          const earlyInfo: VideoInfo = {
            type: 'video',
            id: `early_${Buffer.from(url).toString('base64').substring(0, 10)}`,
            title: meta.title || 'Unknown Video',
            uploader: meta.author || meta.publisher || 'Unknown',
            thumbnail: meta.image || undefined,
            webpageUrl: url,
            formats: [],
            metascraper: meta,
            fromBrain: false,
            isPartial: true,
            isIsrcMatch: false,
            isJsInfo: true,
            isFullData: false,
          };

          const finalEarlyData = await prepareFinalResponse(
            earlyInfo,
            false,
            null,
            url
          );
          finalEarlyData.isPartial = true;

          // skip flickery paint for platform labels
          if (isLowValueEarlyAuthor(finalEarlyData.artist)) {
            logger.info(
              `[Metadata] Skipped low-value early hit (author "${finalEarlyData.artist}")`
            );
            return meta;
          }

          const totalEarlyHitMs = Date.now() - getInfoStart;
          const wallClockMs = options.requestT0
            ? Date.now() - options.requestT0
            : null;
          const wallClockSuffix =
            wallClockMs !== null ? `, wall-clock ${wallClockMs}ms` : '';
          logger.info(
            `[Metadata] Early hit: "${finalEarlyData.title}" by "${finalEarlyData.artist}" (T+${totalEarlyHitMs}ms from getInfo start, dispatch prep ${Date.now() - dispatchStart}ms${wallClockSuffix})`
          );

          options.onProgress(
            'extracting',
            45,
            'Metadata found',
            JSON.stringify({ early_metadata: finalEarlyData })
          );
        } catch (err) {
          logger.error('[Metadata] Early dispatch failed:', err);
        }
      }
      return meta;
    });

  const jsTask = (async () => {
    try {
      const res = await extractor.getInfo(url, options);
      return res;
    } catch {
      recordFailure(`extract:${extractorNames.get(extractor) ?? 'generic'}`);
      return null;
    }
  })();

  inFlightJsTasks.set(url, jsTask);
  jsTask.finally(() => {
    const cleanupTimer = setTimeout(() => {
      if (inFlightJsTasks.get(url) === jsTask) {
        inFlightJsTasks.delete(url);
      }
    }, 30000);
    // allow process exit
    cleanupTimer.unref?.();
  });

  const fastResult = await Promise.race([
    jsTask.then((res) => ({
      type: 'js' as const,
      data: res as VideoInfo | null,
    })),
    metascraperTask.then((meta) => ({ type: 'meta' as const, data: meta })),
    new Promise<{ type: 'timeout'; data: null }>((resolve) =>
      setTimeout(() => resolve({ type: 'timeout', data: null }), 8000)
    ),
  ]);

  if (
    fastResult.type === 'js' &&
    fastResult.data &&
    Array.isArray(fastResult.data.formats) &&
    fastResult.data.formats.length > 0
  ) {
    const meta = await metascraperTask;
    // extractor thumbnail wins; metascraper only fills gaps
    if (meta && !fastResult.data.thumbnail) {
      fastResult.data.metascraper = { image: meta.image };
    }
    return fastResult.data as VideoInfo;
  }

  // js slow/empty: metascraper fallback
  if (fastResult.type === 'meta' && fastResult.data) {
    const meta = fastResult.data;
    return {
      type: 'video',
      id: `meta_${Buffer.from(url).toString('base64').substring(0, 10)}`,
      title: meta.title || 'Unknown Video',
      uploader: meta.author || meta.publisher || 'Unknown',
      webpageUrl: url,
      formats: [],
      thumbnail: meta.image || undefined,
      metascraper: { image: meta.image },
      fromBrain: false,
      isPartial: true,
      isIsrcMatch: false,
      isJsInfo: false,
      isFullData: false,
    } as VideoInfo;
  }

  return await jsTask;
}

export function shouldJSStream(url: string, quality: string, format: string) {
  if (isHost(url, 'youtube.com') || isHost(url, 'youtu.be')) {
    return false;
  }

  // dash: only audio is single-stream
  if (
    isHost(url, 'bilibili.tv') ||
    isHost(url, 'biliintl.com') ||
    isHost(url, 'bili.im')
  ) {
    return ['mp3', 'm4a', 'audio'].includes(format);
  }

  if (
    isHost(url, 'facebook.com') ||
    isHost(url, 'instagram.com') ||
    isHost(url, 'threads.net') ||
    isHost(url, 'threads.com') ||
    isHost(url, 'spotify.com') ||
    isHost(url, 'soundcloud.com') ||
    isHost(url, 'vimeo.com')
  )
    return true;

  if (isHost(url, 'tiktok.com')) return false; // download issues

  if (['mp3', 'm4a', 'audio'].includes(format)) return true;

  const res = parseInt(quality);
  return !isNaN(res) && res <= 720;
}

export {
  youtube,
  instagram,
  facebook,
  tiktok,
  spotify,
  soundcloud,
  threads,
  bilibili,
};
