import type { Format } from '@phantom/extractors';
import type { PageScan } from '../../lib/webviewExtraction/sniffer';
import { setExtractHeaders } from '../../lib/webviewExtraction/host';
import { mp4Format, singleHls, VIDROCK_HEADERS } from './vidrock';
import { log, error as logError } from '../../lib/log';

const BROWSER_TIMEOUT = 40_000;
const EMBED_TIMEOUT = 25_000;
const ADS_RE =
  /dtsedge|dtscout|histats|tynt|cf-insig|beacon|interstitial|googlesyndication|doubleclick|tag.crwdcntrl|gambling|bonus|ad-|ad\.|ads\?|pixel/iu;
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
  scan: ScanFetcher = defaultScan,
  depth = 0
): Promise<{ formats: Format[]; cookies?: string } | null> {
  if (depth > 3) return null;
  const started = Date.now();
  const first = await timedScan(scan, pageUrl, BROWSER_TIMEOUT);
  const direct = formatsOf(first);
  if (direct) return direct;
  const embedCandidates = new Set<string>();
  for (const candidate of first?.frameUrls ?? []) {
    if (!EMBED_SKIP_RE.test(candidate)) embedCandidates.add(candidate);
  }
  for (const snip of first?.frameMeta?.snippets ?? []) {
    const srcMatch = /src=["']([^"']+)["']/iu.exec(snip);
    if (srcMatch && !EMBED_SKIP_RE.test(srcMatch[1])) embedCandidates.add(srcMatch[1]);
    const hrefMatch = /href=["']([^"']+)["']/iu.exec(snip);
    if (hrefMatch && !EMBED_SKIP_RE.test(hrefMatch[1])) embedCandidates.add(hrefMatch[1]);
    const apiMatch = /data-api=["']([^"']+)["']/iu.exec(snip);
    if (apiMatch && !EMBED_SKIP_RE.test(apiMatch[1])) {
      try {
        embedCandidates.add(new URL(apiMatch[1], first?.url ?? pageUrl).toString());
      } catch {
        embedCandidates.add(apiMatch[1]);
      }
    }
  }
  const embeds = [...embedCandidates];
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
    const mapped = await resolveWatchPageViaBrowser(embed, scan, depth + 1);
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

function formatOfUrl(rawUrl: string): boolean {
  try {
    const path = new URL(rawUrl).pathname.toLowerCase();
    return /[.](?:mp4|webm|m3u8|mkv|mov|ts)$/u.test(path) || /[.]m3u8/u.test(rawUrl);
  } catch {
    return /\.(?:mp4|webm|m3u8|mkv|mov|ts)(?:[?#]|$)/iu.test(rawUrl);
  }
}

function formatsOf(scan: PageScan | null): { formats: Format[]; cookies?: string } | null {
  if (!scan || scan.videos.length === 0) return null;
  const seen = new Set<string>();
  const hls: Format[] = [];
  const mp4: Format[] = [];
  for (const video of scan.videos) {
    if (!video.url || video.url === scan.url || seen.has(video.url)) continue;
    if (!formatOfUrl(video.url)) continue;
    if (ADS_RE.test(video.url)) continue;
    seen.add(video.url);
    if (isHls(video)) hls.push(singleHls('browser', video.url));
    else mp4.push(mp4Format('browser', video.url));
  }
  const formats = [...hls, ...mp4];
  if (formats.length === 0) return null;
  return scan.cookies ? { formats, cookies: scan.cookies } : { formats };
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function lunaCookie(): string | undefined {
  const raw = process.env.EXPO_PUBLIC_LUNA_COOKIE;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export async function resolveLunaWatchPage(
  kind: 'movie' | 'tv',
  tmdbId: string,
  title: string,
  scan?: ScanFetcher
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  const started = Date.now();
  const cookie = lunaCookie();
  const page = cookie
    ? kind === 'movie'
      ? `https://watchluna.io/movie/watch-${slugifyTitle(title)}-online-free-${tmdbId}`
      : `https://watchluna.io/tv/watch-${slugifyTitle(title)}-online-free-${tmdbId}`
    : kind === 'movie'
      ? `https://watchluna.gd/watch/movie/${tmdbId}`
      : `https://watchluna.gd/watch/tv/${tmdbId}/1/1`;
  if (cookie) setExtractHeaders({ Cookie: cookie });
  try {
    const viaBrowser =
      scan === undefined
        ? await resolveWatchPageViaBrowser(page)
        : await resolveWatchPageViaBrowser(page, scan);
    const found = viaBrowser?.formats ?? [];
    if (found.length === 0) return null;
    const formats = found.map((format, index) => ({
      ...format,
      formatId: `luna-${format.isHls ? 'hls' : 'mp4'}-${index}`,
      note: `luna ${format.note ?? 'browser'}`,
    }));
    const headers: Record<string, string> = { ...VIDROCK_HEADERS, Referer: page };
    if (viaBrowser?.cookies) headers['Cookie'] = viaBrowser.cookies;
    log(
      'Movies',
      `luna watch ${kind}/${tmdbId} formats=${formats.length} ms=${Date.now() - started}`
    );
    return { formats, headers };
  } finally {
    if (cookie) setExtractHeaders(undefined);
  }
}
