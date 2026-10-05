import type { Format } from '@phantom/extractors';
import type { PageScan } from '../../lib/webviewExtraction/sniffer';
import { mp4Format, singleHls } from './vidrock';
import { log, error as logError } from '../../lib/log';

const BROWSER_TIMEOUT = 40_000;
const EMBED_TIMEOUT = 25_000;
const EMBED_SKIP_RE =
  /recaptcha|googlesyndication|doubleclick|googletagmanager|facebook\.com|stripe|paypal|cookiebot|consent/iu;

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
  const first = await timedScan(scan, pageUrl, BROWSER_TIMEOUT);
  const direct = formatsOf(first);
  if (direct) return direct;
  const embeds = (first?.frameUrls ?? []).filter((url) => !EMBED_SKIP_RE.test(url));
  log('Movies', 'browser frames', `${first?.frames ?? 0}`, 'urls', `${embeds.length}`);
  if (embeds.length > 0) {
    log(
      'Movies',
      'browser embeds',
      embeds
        .slice(0, 3)
        .map((url) => {
          try {
            return new URL(url).hostname;
          } catch {
            return url.slice(0, 40);
          }
        })
        .join(',')
    );
  }
  for (const embed of embeds.slice(0, 2)) {
    const inner = await timedScan(scan, embed, EMBED_TIMEOUT);
    const mapped = formatsOf(inner);
    if (mapped) {
      log('Movies', `browser stream resolved ${mapped.formats.length} ms=${Date.now() - started}`);
      return mapped;
    }
  }
  return null;
}

async function timedScan(
  scan: ScanFetcher,
  url: string,
  timeout: number
): Promise<PageScan | null> {
  try {
    return await Promise.race([
      scan(url),
      new Promise<null>((done) => setTimeout(() => done(null), timeout)),
    ]);
  } catch (err) {
    logError('Movies', `browser stream failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function formatsOf(scan: PageScan | null): { formats: Format[]; cookies?: string } | null {
  if (!scan || scan.videos.length === 0) return null;
  const seen = new Set<string>();
  const hls: Format[] = [];
  const mp4: Format[] = [];
  for (const video of scan.videos) {
    if (!video.url || video.url === scan.url || seen.has(video.url)) continue;
    seen.add(video.url);
    if (isHls(video)) hls.push(singleHls('browser', video.url));
    else mp4.push(mp4Format('browser', video.url));
  }
  const formats = [...hls, ...mp4];
  if (formats.length === 0) return null;
  return scan.cookies ? { formats, cookies: scan.cookies } : { formats };
}
