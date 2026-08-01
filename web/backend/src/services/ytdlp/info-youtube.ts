import fs from 'node:fs';
import { sendEvent } from '../../utils/network/sse.util.js';
import { VideoInfo, Format } from '../../types/index.js';
import {
  setCachedInfo,
  ensureNormalizedFormats,
  runYtdlpInfo,
  prefetchPromises,
  type ProgressCallback,
} from './info-core.js';

async function runYtdlpEnhancement(
  cacheKey: string,
  targetUrl: string,
  cookieArgs: string[],
  baseInfo: VideoInfo | null,
  clientId: string | null,
  precomputed?: Promise<VideoInfo | null> | VideoInfo | null
): Promise<void> {
  try {
    let fullInfo: VideoInfo | null = null;
    if (precomputed !== undefined) {
      fullInfo = await Promise.resolve(precomputed);
    } else {
      fullInfo = await runYtdlpInfo(targetUrl, cookieArgs);
    }

    if (!fullInfo) return;

    fullInfo.isJsInfo = true;
    fullInfo.isPartial = false;
    fullInfo.isFullData = true;
    fullInfo.extractorKey = targetUrl.includes('tiktok.com')
      ? 'tiktok'
      : 'youtube';

    ensureNormalizedFormats(fullInfo);

    const baseFormatCount = baseInfo?.formats?.length || 0;
    const fullFormatCount = fullInfo.formats?.length || 0;

    if (fullFormatCount <= baseFormatCount) {
      return;
    }

    await setCachedInfo(cacheKey, fullInfo);

    if (clientId) {
      const { prepareFinalResponse } =
        await import('../../utils/api/response.util.js');
      const finalData = (await prepareFinalResponse(
        fullInfo,
        false,
        null,
        targetUrl
      )) as VideoInfo;
      console.log(
        `[Info] [Enhancement] yt-dlp added ${fullFormatCount - baseFormatCount} formats for ${finalData.title}, pushing update.`
      );
      console.log(
        `[Info] [Enhancement] Processed formats: ${finalData.formats?.length || 0} video, ${finalData.audioFormats?.length || 0} audio. Heights: ${(finalData.formats || []).map((fmt) => fmt.height || '?').join(',')}`
      );
      sendEvent(clientId, {
        status: 'success',
        text: 'Quality resolution enhanced.',
        metadata_update: {
          ...finalData,
          isFullData: true,
          isPartial: false,
        },
      });
    }
  } catch (error: unknown) {
    console.debug(
      '[Info] [Enhancement] yt-dlp failed:',
      (error as Error).message
    );
  }
}

export async function handleYoutubeTiktokInfo(
  targetUrl: string,
  cacheKey: string,
  cookieArgs: string[],
  clientId: string | null,
  onProgress: ProgressCallback,
  requestT0?: number
): Promise<VideoInfo | null> {
  try {
    const extractorsModule = await import('../extractors/index.js');
    const { getInfo, getInFlightJsResult } = extractorsModule;
    const jsInfo = (await getInfo(targetUrl, {
      onProgress,
      requestT0,
    })) as VideoInfo;

    const hasFormats = jsInfo?.formats?.length > 0;
    const hasMetadata = jsInfo?.title && jsInfo.title !== 'Unknown Video';

    if (!hasFormats && !hasMetadata) return null;

    const extractorKey = targetUrl.includes('tiktok.com')
      ? 'tiktok'
      : 'youtube';

    // tiktok ladder is authoritative; skip yt-dlp
    const isTikTok = extractorKey === 'tiktok';
    const jsLooksHealthy = isTikTok
      ? hasFormats
      : hasFormats &&
        (jsInfo?.formats || []).length >= 3 &&
        (jsInfo?.formats || []).some(
          (formatItem) => (formatItem.height ?? 0) >= 720
        );

    // cache healthy JS
    if (jsLooksHealthy) {
      const fullInfo: VideoInfo = {
        ...jsInfo,
        isJsInfo: true,
        isPartial: false,
        isFullData: true,
        extractorKey,
      };
      await setCachedInfo(cacheKey, fullInfo);

      // JS already returned HD; only enhance via yt-dlp when opted in // eslint-disable-line phantom/phantom-comments
      if (!isTikTok && process.env.YT_DLP_ENHANCE === '1')
        void runYtdlpEnhancement(
          cacheKey,
          targetUrl,
          cookieArgs,
          jsInfo,
          clientId
        );

      const { prepareFinalResponse } =
        await import('../../utils/api/response.util.js');
      return (await prepareFinalResponse(
        jsInfo,
        false,
        null,
        targetUrl
      )) as VideoInfo;
    }

    if (hasFormats) {
      console.log(
        `[Info] JS race winner has only ${(jsInfo?.formats || []).length} formats (no 720p+); escalating to fallbackTask.`
      );
    }

    /**
     * Meta-only result (oEmbed/metascraper won the race). Spawn a background
     * resolution task: prefer the still-running JS extractor, only fall back
     * to yt-dlp if JS produced no formats. After JS settles, run yt-dlp as a
     * detached enhancement pass so 4K/8K formats still get added without
     * blocking the prefetch promise.
     */
    const fallbackTask = (async () => {
      try {
        const prefetchUrl = jsInfo?.targetUrl || targetUrl;

        // yt-dlp only as fallback when JS empty, or eagerly via YT_DLP_ENHANCE
        const enhance = process.env.YT_DLP_ENHANCE === '1';
        let ytdlpProc: Promise<VideoInfo | null> | null = null;
        const runYtdlp = () =>
          (ytdlpProc ??= runYtdlpInfo(prefetchUrl, cookieArgs).catch(
            (error: unknown) => {
              console.debug(
                '[Info] [Background] yt-dlp fallback failed:',
                (error as Error).message
              );
              return null;
            }
          ));
        if (enhance) runYtdlp();

        const jsPromise = getInFlightJsResult(targetUrl);
        if (jsPromise) {
          const jsResult = await jsPromise;
          const jsFormats = jsResult?.formats || [];
          /**
           * Treat as "JS empty" if the JS path produced only a tiny subset
           * (e.g. Termux decipher failures often leave only the muxed 360p
           * legacy stream). Threshold: at least 3 formats AND at least one
           * 720p+ entry. Otherwise yt-dlp will give us the real picture.
           */
          const jsHasHd = jsFormats.some(
            (formatItem) => (formatItem.height ?? 0) >= 720
          );
          const jsLooksHealthy =
            jsResult !== null && jsFormats.length >= 3 && jsHasHd;

          if (jsLooksHealthy && jsResult) {
            const fullInfo: VideoInfo = {
              ...jsResult,
              isJsInfo: true,
              isPartial: false,
              isFullData: true,
              extractorKey,
            };

            await setCachedInfo(cacheKey, fullInfo);

            if (clientId) {
              const { prepareFinalResponse } =
                await import('../../utils/api/response.util.js');
              const finalData = (await prepareFinalResponse(
                fullInfo,
                false,
                null,
                targetUrl
              )) as VideoInfo;
              console.log(
                `[Info] [Background] JS resolution complete for ${finalData.title} (${jsFormats.length} JS formats), pushing update.`
              );
              sendEvent(clientId, {
                status: 'success',
                text: 'Quality resolution complete.',
                metadata_update: {
                  ...finalData,
                  isFullData: true,
                  isPartial: false,
                },
              });
            }

            if (enhance)
              void runYtdlpEnhancement(
                cacheKey,
                targetUrl,
                cookieArgs,
                jsResult,
                clientId,
                runYtdlp()
              );
            return fullInfo;
          }

          if (jsFormats.length > 0) {
            console.log(
              `[Info] [Background] JS produced only ${jsFormats.length} formats (HD=${jsHasHd}); escalating to yt-dlp speculative.`
            );
          }
        }

        // js empty → real yt-dlp fallback
        console.log('[Info] [Background] JS empty, falling back to yt-dlp...');
        const fullInfo = await runYtdlp();
        if (!fullInfo) {
          console.warn(
            '[Info] [Background] Speculative yt-dlp returned no info'
          );
          return null;
        }

        fullInfo.isJsInfo = true;
        fullInfo.isPartial = false;
        fullInfo.isFullData = true;
        fullInfo.extractorKey = extractorKey;

        ensureNormalizedFormats(fullInfo);

        await setCachedInfo(cacheKey, fullInfo);

        if (clientId) {
          const { prepareFinalResponse } =
            await import('../../utils/api/response.util.js');
          const finalData = (await prepareFinalResponse(
            fullInfo,
            false,
            null,
            targetUrl
          )) as VideoInfo;

          console.log(
            `[Info] [Background] Deep-scan complete for ${finalData.title}, pushing update.`
          );
          sendEvent(clientId, {
            status: 'success',
            text: 'Quality resolution complete.',
            metadata_update: {
              ...finalData,
              isFullData: true,
              isPartial: false,
            },
          });
        }
        return fullInfo;
      } catch (error: unknown) {
        console.warn(
          '[Info] [Background] Resolution failed:',
          (error as Error).message
        );
        return null;
      } finally {
        prefetchPromises.delete(cacheKey);
      }
    })();

    prefetchPromises.set(
      cacheKey,
      fallbackTask as Promise<VideoInfo | undefined>
    );

    // fast partial return
    console.log(
      '[Info] Fast metadata hit, returning partial info immediately.'
    );
    return {
      ...jsInfo,
      isPartial: true,
      formats: [],
      audioFormats: [],
    } as VideoInfo;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'ZodError') {
      const issues = (err as { issues?: unknown }).issues;
      console.error('[Metadata] Zod Validation Failed for Pure-JS:', issues);
    }
    console.warn(
      `[Metadata] Engine: Pure-JS URL: ${targetUrl} (Failed: ${err.message})`
    );
  }
  return null;
}

function extractCookiesFromFile(cookieArgs: string[]): string | undefined {
  if (cookieArgs.includes('--cookies')) {
    const cookiePath = cookieArgs[cookieArgs.indexOf('--cookies') + 1];
    if (cookiePath && fs.existsSync(cookiePath)) {
      const content = fs.readFileSync(cookiePath, 'utf8');
      const lines = content.split('\n');
      const pairs: string[] = [];
      for (const line of lines) {
        if (!line.trim() || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7)
          pairs.push(`${parts[5].trim()}=${parts[6].trim()}`);
      }
      return pairs.join('; ');
    }
  }
  return undefined;
}

const _handleHasHD = (
  jsInfo: VideoInfo,
  targetUrl: string,
  platform: string
) => {
  const formats = jsInfo.formats || [];
  const hasHD = formats.some(
    (formatItem: Format) =>
      (formatItem.resolution &&
        (formatItem.resolution.includes('720') ||
          formatItem.resolution.includes('1080') ||
          formatItem.resolution.includes('HD') ||
          formatItem.resolution.includes('Source'))) ||
      (formatItem.height && formatItem.height >= 720)
  );

  const isFbStory =
    targetUrl.includes('/stories/') || jsInfo.webpageUrl?.includes('/stories/');
  const hasPhoto = formats.some((formatItem: Format) =>
    formatItem.formatId.startsWith('photo')
  );
  // audio-only (soundcloud) has no HD concept
  const isAudioOnly =
    formats.length > 0 &&
    formats.every(
      (formatItem: Format) =>
        formatItem.isAudio || formatItem.resolution === 'Audio'
    );

  if (!hasHD && !isFbStory && !hasPhoto && !isAudioOnly) {
    console.log(
      `[Metadata] Engine: Pure-JS | Platform: ${platform} | URL: ${targetUrl} (SD only, falling back to yt-dlp for HD)`
    );
    return null;
  }
  return jsInfo;
};

export async function handleSocialJSInfo(
  targetUrl: string,
  cacheKey: string,
  cookieArgs: string[],
  onProgress: ProgressCallback
): Promise<VideoInfo | null> {
  const platform = targetUrl.includes('facebook.com')
    ? 'Facebook'
    : targetUrl.includes('instagram.com')
      ? 'Instagram'
      : targetUrl.includes('tiktok.com')
        ? 'TikTok'
        : targetUrl.includes('bilibili.tv') ||
            targetUrl.includes('biliintl.com') ||
            targetUrl.includes('bili.im')
          ? 'Bilibili'
          : 'Social';

  try {
    const rawCookie = extractCookiesFromFile(cookieArgs);

    const { getInfo, getInFlightJsResult } =
      await import('../extractors/index.js');
    const jsInfo = (await getInfo(targetUrl, {
      cookie: rawCookie,
      onProgress,
    })) as VideoInfo;

    // metascraper may win; await real js
    let resolved = jsInfo;
    if (!jsInfo?.formats?.length) {
      const inflight = getInFlightJsResult(targetUrl);
      const jsActual = inflight ? await inflight : null;
      if (jsActual?.formats?.length) {
        jsActual.metascraper = jsActual.metascraper || jsInfo?.metascraper;
        jsActual.thumbnail = jsActual.thumbnail || jsInfo?.thumbnail;
        resolved = jsActual;
      }
    }

    if (resolved?.formats?.length > 0) {
      const finalInfo = _handleHasHD(resolved, targetUrl, platform);
      if (finalInfo) {
        await setCachedInfo(cacheKey, finalInfo);
        return finalInfo;
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.warn(
      `[Metadata] Engine: Pure-JS | Platform: ${platform} | URL: ${targetUrl} (Failed: ${err.message})`
    );
  }
  return null;
}
