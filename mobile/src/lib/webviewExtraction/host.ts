import { AppState } from 'react-native';
import { log } from '../log';
import {
  SNIFFER_JS,
  PageScan,
  ScannedVideo,
  dedupeVideos,
  isMediaUrl,
  parseWebViewMessage,
} from './sniffer';

const TAG = 'webviewExtraction';

interface WebViewHandle {
  navigate: (uri: string) => void;
  injectJavaScript: (js: string) => void;
}

interface Pending {
  url: string;
  pageUrl: string;
  resolve: (scan: PageScan | null) => void;
  timer: ReturnType<typeof setTimeout>;
  onScan?: (scan: PageScan) => void;
  isDirect?: boolean;
}

let handle: WebViewHandle | null = null;
let active: Pending | null = null;
const queue: Pending[] = [];
const inflight = new Map<string, Promise<PageScan | null>>();
let extraVideos: ScannedVideo[] = [];
let bestScan: PageScan | null = null;
let emptyTimer: ReturnType<typeof setTimeout> | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probed: string[] = [];
let realScan: PageScan | null = null;
let scanCounter = 0;
let currentScanId: number | undefined;
let lastInjectedUrl: string | undefined;

const EMPTY_SCAN_GRACE = 7_000;
const PROBE_GRACE = 1_500;

// players park a placeholder <video src> = page url until the stream loads
function hasRealVideos(scan: PageScan): boolean {
  return scan.videos.some((video) => video.url !== scan.url);
}

function clearEmptyTimer(): void {
  if (emptyTimer) {
    clearTimeout(emptyTimer);
    emptyTimer = null;
  }
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

// hidden metadata-only player for a bare file url: browser fetches the
// headers (moov included), so dims resolve without downloading the media
function probePage(url: string): string {
  const html = `<html><body><video src="${url.replace(/"/gu, '%22')}" preload="metadata" playsinline muted autoplay style="display:none"></video></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function finish(scan: PageScan | null): void {
  if (!active) return;
  clearTimeout(active.timer);
  clearProbeTimer();
  const pending = active;
  active = null;
  inflight.delete(pending.url);
  clearEmptyTimer();
  handle?.navigate('about:blank');
  if (scan) {
    const merged = {
      ...scan,
      // probe page navigates a data: url; restore the real target
      url: pending.isDirect ? pending.url : scan.url,
      isDirect: pending.isDirect ? true : scan.isDirect,
      videos: dedupeVideos([...extraVideos, ...scan.videos]),
    };
    log(
      TAG,
      'scan resolved',
      merged.url,
      `| title: ${merged.title || '(empty)'}`,
      `| videos: ${merged.videos.length}`,
      merged.videos.map((video) => video.url),
      `| cookies: ${merged.cookies ? 'yes' : 'no'}`
    );
    pending.onScan?.(merged);
    pending.resolve(merged);
  } else {
    pending.resolve(null);
  }
  pump();
}

function pump(): void {
  if (active || queue.length === 0 || !handle) return;
  const pending = queue.shift();
  if (!pending) return;
  active = pending;
  extraVideos = [];
  bestScan = null;
  lastInjectedUrl = undefined;
  probed = [];
  realScan = null;
  log(TAG, 'extract start', pending.url);
  handle.navigate(pending.pageUrl);
  pending.timer = setTimeout(() => {
    log(TAG, 'timeout (30s), no scan', pending.url);
    finish(null);
  }, 30_000);
}

// android fires onLoadEnd for iframes and navigationStateChange repeats:
// inject once per distinct page url, or ids churn and scans go stale
function injectSniffer(url: string): void {
  if (!active || url === lastInjectedUrl) return;
  lastInjectedUrl = url;
  scanCounter += 1;
  currentScanId = scanCounter;
  handle?.injectJavaScript(`window.__phantom_scan_id=${scanCounter};${SNIFFER_JS}`);
}

export function attachWebView(webview: WebViewHandle): void {
  handle = webview;
  pump();
}

export function detachWebView(): void {
  handle = null;
  while (queue.length > 0) {
    const pending = queue.shift();
    if (pending) {
      inflight.delete(pending.url);
      pending.resolve(null);
    }
  }
  finish(null);
}

function scanIdOf(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as { id?: number };
    return typeof parsed.id === 'number' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

export function onWebViewMessage(raw: string): void {
  const scan = parseWebViewMessage(raw);
  if (!active || !scan) return;
  const id = scanIdOf(raw);
  if (id !== undefined && id !== currentScanId) {
    log(TAG, 'stale scan ignored', id, 'active', currentScanId);
    return;
  }
  // SPA players populate the dom long after the first scans: hold when no real
  // media yet. one shot from the first empty scan covers every sniffer post
  // (250ms/1.5s/5s) — the last scan is the decider.
  if (hasRealVideos(scan)) {
    // xhr-fetched streams have no <video> element: probe them for metadata
    // (a direct-paste probe page already probes its own target)
    const missing = active.isDirect
      ? []
      : scan.videos.filter(
          (video) => !video.height && !probed.includes(video.url)
        );
    if (missing.length > 0) {
      realScan = scan;
      for (const video of missing) {
        probed.push(video.url);
        handle?.injectJavaScript(
          `window.__phantom_probe(${JSON.stringify(video.url)});`
        );
      }
      if (!probeTimer) {
        probeTimer = setTimeout(() => {
          probeTimer = null;
          log(TAG, 'probe grace elapsed, settling', active?.url);
          if (realScan) finish(realScan);
        }, PROBE_GRACE);
      }
      return;
    }
    finish(scan);
    return;
  }
  bestScan = scan;
  if (!emptyTimer) {
    emptyTimer = setTimeout(() => {
      emptyTimer = null;
      // captured media requests count, even when every scan was empty
      const settled =
        bestScan && (hasRealVideos(bestScan) || extraVideos.length > 0)
          ? bestScan
          : null;
      log(TAG, 'empty scans only, settling', active?.url);
      finish(settled);
    }, EMPTY_SCAN_GRACE);
  }
}

export function onWebViewPageEnded(url: string): void {
  injectSniffer(url);
}

export function onWebViewRequest(url: string): void {
  if (!active || !isMediaUrl(url)) return;
  log(TAG, 'media request', url);
  // probe page reports the target itself through its scan; don't resolve yet
  if (url === active.url) {
    if (!active.isDirect) {
      finish({
        url,
        title: '',
        videos: [{ url }],
        images: [],
      });
    }
    return;
  }
  if (!extraVideos.some((video) => video.url === url)) {
    extraVideos.push({ url });
  }
}

export function onWebViewFailed(): void {
  finish(null);
}

export function onWebViewHttpError(url: string): void {
  if (active && url === active.url) {
    log(TAG, 'http error on active page', url);
    finish(null);
  }
}

AppState.addEventListener('change', (state) => {
  if (state !== 'background') return;
  while (queue.length > 0) {
    const pending = queue.shift();
    if (pending) {
      inflight.delete(pending.url);
      pending.resolve(null);
    }
  }
  finish(null);
});

export function extractFromPage(
  url: string,
  onScan?: (scan: PageScan) => void
): Promise<PageScan | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  let pending: Pending | null = null;
  const promise = new Promise<PageScan | null>((resolve) => {
    // bare file paste: probe page loads its metadata so dims are known
    const isDirect = isMediaUrl(url);
    pending = {
      url,
      pageUrl: isDirect ? probePage(url) : url,
      resolve,
      timer: setTimeout(() => {}, 0),
      onScan,
      isDirect,
    };
  });
  if (!pending) throw new Error('unreachable');
  inflight.set(url, promise);
  queue.push(pending);
  pump();
  return promise;
}
