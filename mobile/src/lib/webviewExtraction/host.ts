import { AppState } from 'react-native';
import {
  SNIFFER_JS,
  PageScan,
  ScannedVideo,
  dedupeVideos,
  isMediaUrl,
  parseWebViewMessage,
} from './sniffer';

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
let extraVideos: ScannedVideo[] = [];

function finish(scan: PageScan | null): void {
  if (!active) return;
  clearTimeout(active.timer);
  const pending = active;
  active = null;
  handle?.navigate('about:blank');
  if (scan) {
    const merged = {
      ...scan,
      videos: dedupeVideos([...extraVideos, ...scan.videos]),
    };
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
  handle.navigate(pending.url);
  pending.timer = setTimeout(() => finish(null), 30_000);
}

export function attachWebView(webview: WebViewHandle): void {
  handle = webview;
  pump();
}

export function detachWebView(): void {
  handle = null;
  while (queue.length > 0) queue.shift()?.resolve(null);
  finish(null);
}

export function onWebViewMessage(raw: string): void {
  const scan = parseWebViewMessage(raw);
  if (active && scan) finish(scan);
}

export function onWebViewPageEnded(): void {
  if (active) handle?.injectJavaScript(SNIFFER_JS);
}

export function onWebViewRequest(url: string): void {
  if (!active || !isMediaUrl(url)) return;
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
  if (active && url === active.url) finish(null);
}

AppState.addEventListener('change', (state) => {
  if (state !== 'background') return;
  while (queue.length > 0) queue.shift()?.resolve(null);
  finish(null);
});

export function extractFromPage(
  url: string,
  onScan?: (scan: PageScan) => void
): Promise<PageScan | null> {
  return new Promise((resolve) => {
    queue.push({ url, resolve, timer: setTimeout(() => {}, 0), onScan });
    pump();
  });
}
