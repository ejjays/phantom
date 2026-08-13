import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { SNIFFER_JS } from '../src/lib/webviewExtraction/sniffer';

const { listeners } = vi.hoisted(() => ({
  listeners: [] as Array<(state: string) => void>,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_type: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return { remove: () => undefined };
    },
  },
}));

import {
  attachWebView,
  detachWebView,
  extractFromPage,
  onWebViewFailed,
  onWebViewHttpError,
  onWebViewMessage,
  onWebViewPageEnded,
  onWebViewRequest,
} from '../src/lib/webviewExtraction/host';

const scanMessage = (url: string) =>
  JSON.stringify({
    type: 'pageScan',
    data: { url, title: 't', videos: [{ url: `${url}/v.mp4` }], images: [] },
  });

const makeHandle = () => ({
  navigate: vi.fn(),
  injectJavaScript: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  detachWebView();
  vi.useRealTimers();
});

describe('webview host', () => {
  it('loads queued urls sequentially', () => {
    const handle = makeHandle();
    attachWebView(handle);

    const first = extractFromPage('https://a.com');
    const second = extractFromPage('https://b.com');
    expect(handle.navigate).toHaveBeenCalledTimes(1);
    expect(handle.navigate).toHaveBeenCalledWith('https://a.com');

    onWebViewMessage(scanMessage('https://a.com'));
    return expect(first)
      .resolves.toMatchObject({ url: 'https://a.com' })
      .then(() => {
        expect(handle.navigate).toHaveBeenLastCalledWith('https://b.com');
        onWebViewMessage(scanMessage('https://b.com'));
        return expect(second).resolves.toMatchObject({ url: 'https://b.com' });
      });
  });

  it('streams partial scans via onScan', async () => {
    const handle = makeHandle();
    attachWebView(handle);

    const onScan = vi.fn();
    const promise = extractFromPage('https://a.com', onScan);
    onWebViewMessage(scanMessage('https://a.com'));
    await promise;

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0][0].videos).toHaveLength(1);
  });

  it('injects the sniffer after page load', () => {
    const handle = makeHandle();
    attachWebView(handle);
    void extractFromPage('https://a.com');

    onWebViewPageEnded();
    expect(handle.injectJavaScript).toHaveBeenCalledWith(SNIFFER_JS);
  });

  it('does not inject while idle', () => {
    const handle = makeHandle();
    attachWebView(handle);
    onWebViewPageEnded();
    expect(handle.injectJavaScript).not.toHaveBeenCalled();
  });

  it('resolves null on timeout', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    vi.advanceTimersByTime(30_000);
    await expect(promise).resolves.toBeNull();
    expect(handle.navigate).toHaveBeenCalled();
  });

  it('resolves null on http error for the active page', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    onWebViewHttpError('https://a.com');
    await expect(promise).resolves.toBeNull();
  });

  it('ignores http errors from subresources', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    onWebViewHttpError('https://cdn.example/logo.png');
    expect(handle.navigate).toHaveBeenCalledTimes(1);

    onWebViewMessage(scanMessage('https://a.com'));
    await expect(promise).resolves.toMatchObject({ url: 'https://a.com' });
  });

  it('resolves null on load failure', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    onWebViewFailed();
    await expect(promise).resolves.toBeNull();
  });

  it('resolves null when app backgrounds', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    listeners[0]('background');
    await expect(promise).resolves.toBeNull();
  });

  it('detach resolves pending and queued', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const first = extractFromPage('https://a.com');
    const second = extractFromPage('https://b.com');

    detachWebView();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });
});

describe('media request interception', () => {
  it('records media requests into the final scan', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    onWebViewRequest('https://cdn.example/video.mp4');
    onWebViewMessage(scanMessage('https://a.com'));
    const scan = await promise;

    expect(scan?.videos.map((video) => video.url)).toEqual([
      'https://cdn.example/video.mp4',
      'https://a.com/v.mp4',
    ]);
  });

  it('finishes immediately when the target url itself is media', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://cdn.example/movie.m3u8');

    onWebViewRequest('https://cdn.example/movie.m3u8');
    const scan = await promise;

    expect(scan).toEqual({
      url: 'https://cdn.example/movie.m3u8',
      title: '',
      videos: [{ url: 'https://cdn.example/movie.m3u8' }],
      images: [],
    });
    expect(handle.navigate).toHaveBeenLastCalledWith('about:blank');
  });

  it('ignores non-media requests', async () => {
    const handle = makeHandle();
    attachWebView(handle);
    const promise = extractFromPage('https://a.com');

    onWebViewRequest('https://cdn.example/style.css');
    onWebViewRequest('https://cdn.example/banner.jpg');
    onWebViewMessage(scanMessage('https://a.com'));
    const scan = await promise;

    expect(scan?.videos.map((video) => video.url)).toEqual([
      'https://a.com/v.mp4',
    ]);
  });

  it('ignores requests while idle', () => {
    const handle = makeHandle();
    attachWebView(handle);
    onWebViewRequest('https://cdn.example/video.mp4');
    expect(handle.navigate).not.toHaveBeenCalled();
  });
});
