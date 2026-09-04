import {
  VideoInfo,
  Format,
  noVideo,
  temporaryError,
  classifyThrown,
} from '@phantom/extractors';
import { fetchHtml, fetchFileSize } from './fetcher';
import { parseHtml } from '@phantom/extractors/facebook/parser';
import { normalizeVideoInfo } from './normalizer';
import { mapLimit } from '../../lib/net';
import { buildVideoInfo } from '../shared/videoInfo';
import { error as logError } from '../../lib/log';

export async function getInfo(
  url: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  try {
    const fetchResult = await fetchHtml(url, {});
    if (!fetchResult) throw temporaryError('Facebook');

    const { html, targetUrl } = fetchResult;

    const parsedData = parseHtml(html, targetUrl);

    let videoInfo = normalizeVideoInfo(targetUrl, parsedData);
    if (!videoInfo) throw noVideo('Facebook');

    onPartial?.(buildVideoInfo({ ...videoInfo, formats: [], isPartial: true }));

    for (
      let attempt = 0;
      attempt < 1 && videoInfo.title === videoInfo.uploader;
      attempt += 1
    ) {
      const retry = await fetchHtml(url, {}, 2500).catch(() => null);
      const alt = retry
        ? normalizeVideoInfo(
            retry.targetUrl,
            parseHtml(retry.html, retry.targetUrl)
          )
        : null;
      if (!alt || alt.formats.length === 0) break;
      videoInfo = alt;
    }

    await mapLimit(videoInfo.formats, 2, async (format: Format) => {
      if (!format.url || format.filesize) return;
      const size = await fetchFileSize(format.url);
      if (size) format.filesize = size;
    });

    return videoInfo;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('index', `[JS-FB] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Facebook');
  }
}
