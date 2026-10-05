import type { Format } from '@phantom/extractors';
import type { PageScan } from '../../lib/webviewExtraction/sniffer';
import { mp4Format, singleHls } from './vidrock';
import { log, error as logError } from '../../lib/log';

const BROWSER_TIMEOUT = 40_000;

type ScanFetcher = (url: string) => Promise<PageScan | null>;

async function defaultScan(url: string): Promise<PageScan | null> {
  const { extractFromPage } = await import('../../lib/webviewExtraction/host');
  return extractFromPage(url);
}

function isHls(video: PageScan['videos'][number]): boolean {
  return /[.]m3u8(?:[?#]|$)/iu.test(video.url) || /m3u8/iu.test(video.url);
}

export async function resolveWatchPageViaBrowser(
  pageUrl: string,
  scan: ScanFetcher = defaultScan
): Promise<{ formats: Format[]; cookies?: string } | null> {
  const started = Date.now();
  let result: PageScan | null = null;
  try {
    result = await Promise.race([
      scan(pageUrl),
      new Promise<null>((done) => setTimeout(() => done(null), BROWSER_TIMEOUT)),
    ]);
  } catch (err) {
    logError('Movies', `browser stream failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!result || result.videos.length === 0) return null;
  const seen = new Set<string>();
  const hls: Format[] = [];
  const mp4: Format[] = [];
  for (const video of result.videos) {
    if (!video.url || video.url === result.url || seen.has(video.url)) continue;
    seen.add(video.url);
    if (isHls(video)) hls.push(singleHls('browser', video.url));
    else mp4.push(mp4Format('browser', video.url));
  }
  const formats = [...hls, ...mp4];
  if (formats.length === 0) return null;
  log('Movies', `browser stream resolved ${formats.length} ms=${Date.now() - started}`);
  return result.cookies ? { formats, cookies: result.cookies } : { formats };
}
