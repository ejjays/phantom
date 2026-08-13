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
  resolve: (scan: PageScan | null) => void;
  timer: ReturnType<typeof setTimeout>;
  onScan?: (scan: PageScan) => void;
}

let handle: WebViewHandle | null = null;
let active: Pending | null = null;
const queue: Pending[] = [];
const inflight = new Map<string, Promise<PageScan | null>>();
let extraVideos: ScannedVideo[] = [];
let bestScan: PageScan | null = null;
let emptyTimer: ReturnType<typeof setTimeout> | null = null;
let scanCounter = 0;
let currentScanId: number | undefined;
let lastInjectedUrl: string | undefined;

const EMPTY_SCAN_GRACE = 7_000;

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

function finish(scan: PageScan | null): void {
  if (!active) return;
  clearTimeout(active.timer);
  const pending = active;
  active = null;
  inflight.delete(pending.url);
  clearEmptyTimer();
  handle?.navigate('about:blank');
  if (scan) {
    const merged = {
      ...scan,
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
  log(TAG, 'extract start', pending.url);
  handle.navigate(pending.url);
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
  // direct media paste: the target url itself is the file
  if (url === active.url) {
    finish({
      url,
      title: '',
      videos: [{ url }],
      images: [],
    });
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
  // direct media paste: the file is the answer, no page to scan
  if (isMediaUrl(url)) {
    const scan: PageScan = { url, title: '', videos: [{ url }], images: [] };
    return Promise.resolve(scan);
  }
  const existing = inflight.get(url);
  if (existing) return existing;
  let pending: Pending | null = null;
  const promise = new Promise<PageScan | null>((resolve) => {
    pending = { url, resolve, timer: setTimeout(() => {}, 0), onScan };
  });
  if (!pending) throw new Error('unreachable');
  inflight.set(url, promise);
  queue.push(pending);
  pump();
  return promise;
}
