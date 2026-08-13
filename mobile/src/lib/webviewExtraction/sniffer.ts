export interface ScannedVideo {
  url: string;
  poster?: string;
  type?: string;
}

export interface PageScan {
  url: string;
  title: string;
  videos: ScannedVideo[];
  images: Array<{ url: string }>;
  cookies?: string;
  ogImage?: string;
  isDirect?: boolean;
}

const MEDIA_RE = /\.(?:mp4|webm|m3u8|m4s|mkv|mov)(?:[?#]|$)/iu;

export function isMediaUrl(url: string): boolean {
  return MEDIA_RE.test(url);
}

export function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export function extensionOf(url: string): string {
  const match = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/iu);
  return match ? match[1].toLowerCase() : 'mp4';
}

export function dedupeVideos(videos: ScannedVideo[]): ScannedVideo[] {
  const seen = new Set<string>();
  const out: ScannedVideo[] = [];
  for (const video of videos) {
    if (!video.url || seen.has(video.url)) continue;
    seen.add(video.url);
    out.push(video);
  }
  return out;
}

export function hashUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// runs inside the page; DOM access only, never imported by node tests
export const SNIFFER_JS = `(() => {
  const post = (m) => {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ id: window.__phantom_scan_id }, m))); } catch (e) {}
  };
  const collect = () => {
    const out = { url: location.href, title: document.title, videos: [], images: [], cookies: document.cookie };
    const abs = (u) => {
      try { return new URL(u, location.href).href; } catch (e) { return null; }
    };
    const media = (u) => /[.](mp4|webm|m3u8|m4s|mkv|mov)(\\?|#|$)/i.test(u || '');
    const push = (src, el, list) => {
      const url = abs(src);
      if (!url || !/^https?:/i.test(url)) return;
      if (list.some((v) => v.url === url)) return;
      const item = { url };
      if (el && el.poster) item.poster = el.poster;
      if (el && el.type) item.type = el.type;
      list.push(item);
    };
    document.querySelectorAll('video').forEach((v) => {
      push(v.currentSrc || v.src, v, out.videos);
      if (v.currentSrc) push(v.src, v, out.videos);
    });
    document.querySelectorAll('video source').forEach((s) => push(s.src, s, out.videos));
    document.querySelectorAll('a[href]').forEach((a) => {
      if (media(a.href)) push(a.href, null, out.videos);
    });
    // player fetches (XHR/fetch) never hit the RN webview load events: the real
    // stream url lives in the resource timing buffer instead
    if (window.performance && window.performance.getEntriesByType) {
      window.performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .forEach((url) => {
          if (media(url)) push(url, null, out.videos);
        });
    }
    document.querySelectorAll('img').forEach((img) => {
      if (img.src && /^https?:/i.test(img.src) && !/[.]svg(\\?|#|$)/i.test(img.src)) {
        const url = abs(img.src);
        if (url && !out.images.some((i) => i.url === url)) out.images.push({ url });
      }
    });
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) out.ogImage = abs(og.content);
    const link = document.querySelector('link[rel="image_src"]');
    if (!out.ogImage && link && link.href) out.ogImage = abs(link.href);
    post({ type: 'pageScan', data: out });
  };
  window.addEventListener('load', () => setTimeout(collect, 250));
  setTimeout(collect, 1500);
  setTimeout(collect, 5000);
  post({ type: 'ready' });
})();`;

export function parseWebViewMessage(raw: string): PageScan | null {
  try {
    const data = JSON.parse(raw) as {
      type?: string;
      id?: number;
      data?: PageScan;
    };
    if (data.type !== 'pageScan' || !data.data || !data.data.url) return null;
    return data.data;
  } catch {
    return null;
  }
}
