import { getProxiedStream } from '../../../utils/network/proxy.util.js';
import { logger } from '../../../utils/infra/logger.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../../types/index.js';
import { Readable } from 'node:stream';
import { DESKTOP_UA, STREAM_REFERER } from './constants.js';
import { fetchHtml, fetchEmbed, fetchFileSize } from './fetcher.js';
import { parseHtml } from './parser.js';
import { normalizeVideoInfo } from './normalizer.js';

function extract(html: string, targetUrl: string): VideoInfo | null {
  return normalizeVideoInfo(targetUrl, parseHtml(html, targetUrl));
}

export async function getInfo(
  url: string,
  options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const primary = await fetchHtml(url, options);
    let videoInfo = primary ? extract(primary.html, primary.targetUrl) : null;

    // walled/empty page: try public embed
    if (!videoInfo || videoInfo.formats.length === 0) {
      const embed = await fetchEmbed(url, options);
      const alt = embed ? extract(embed.html, embed.targetUrl) : null;
      if (alt && alt.formats.length > 0) videoInfo = alt;
    }

    if (!videoInfo || videoInfo.formats.length === 0) return null;

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
    logger.error(`[JS-Threads] Error extracting ${url}: ${message}`);
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
      Referer: STREAM_REFERER,
      Origin: 'https://www.threads.com',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Range: 'bytes=0-',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    })
  );
}
