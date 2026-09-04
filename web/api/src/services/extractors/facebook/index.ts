import { getProxiedStream } from '../../../utils/network/proxy.util.js';
import { logger } from '../../../utils/infra/logger.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../../types/index.js';
import { Readable } from 'node:stream';
import { DESKTOP_UA } from './constants.js';
import { fetchHtml, fetchFileSize } from './fetcher.js';
import { parseHtml } from './parser.js';
import { normalizeVideoInfo } from './normalizer.js';

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const fetchResult = await fetchHtml(url, _options);
    if (!fetchResult) return null;

    const { html, targetUrl } = fetchResult;

    const parsedData = parseHtml(html, targetUrl);

    let videoInfo = normalizeVideoInfo(targetUrl, parsedData);
    if (!videoInfo) return null;

    // recover title if still generic
    for (
      let attempt = 0;
      attempt < 1 && videoInfo.title === videoInfo.uploader;
      attempt += 1
    ) {
      const retry = await fetchHtml(url, _options, 2500).catch(() => null);
      const alt = retry
        ? normalizeVideoInfo(
            retry.targetUrl,
            parseHtml(retry.html, retry.targetUrl)
          )
        : null;
      if (!alt || alt.formats.length === 0) break;
      videoInfo = alt;
    }

    // fetch size
    for (let i = 0; i < videoInfo.formats.length; i += 3) {
      const batch = videoInfo.formats.slice(i, i + 3);
      await Promise.all(
        batch.map(async (format: Format) => {
          if (format.url) {
            const size = await fetchFileSize(format.url);
            if (size) format.filesize = size;
          }
        })
      );
    }

    return videoInfo;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[JS-FB] Error extracting ${url}: ${message}`);
    return null;
  }
}

export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const targetFormat =
    videoInfo.formats.find(
      (formatItem: Format) =>
        String(formatItem.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!targetFormat?.url) throw new Error('No stream URL found');

  return Promise.resolve(
    getProxiedStream(targetFormat.url, {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.facebook.com/',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Range: 'bytes=0-',
      Origin: 'https://www.facebook.com',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    })
  );
}
