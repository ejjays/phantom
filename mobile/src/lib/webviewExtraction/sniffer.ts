export interface ScannedVideo {
  url: string;
  poster?: string;
  type?: string;
  width?: number;
  height?: number;
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

const MEDIA_RE = /\.(?:mp4|webm|m3u8|mkv|mov)(?:[?#]|$)/iu;

// asset files that can carry "media"/"video" in their names (MediaLayer.js…)
export const MEDIA_JUNK_RE =
  /[.](?:js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|ico|json|xml|html?|wasm|map|txt|zip|gz|pdf|webmanifest)(?:[?#]|$)/iu;

// endpoint-style stream urls (getmp4/video/… without an extension) that only
// prove themselves as media through a metadata probe; \b keeps js bundle names
// like MediaTopic_Hook.js from matching
export const MEDIA_WIDE_RE =
  /(?:\b(?:video|media|stream|getmp4|playlist|manifest|mime)\b)|\.(?:mpd|ts)(?:[?#]|$)/iu;

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

// parses an HLS manifest into candidate streams; media playlists report
// themselves (the manifest is the stream), masters report their variants.
// embedded into SNIFFER_JS via toString(), so keep it self-contained
export function hlsVideosOf(text: string, base: string): ScannedVideo[] {
  const manifest = (text || '').trim();
  if (!/^#EXTM3U/iu.test(manifest)) return [];
  const lines = manifest.split(/\r?\n/);
  if (lines.some((line) => /^#EXTINF:/iu.test(line))) {
    return [{ url: base, type: 'm3u8' }];
  }
  const out: ScannedVideo[] = [];
  for (let i = 0; i < lines.length && out.length < 12; i += 1) {
    if (!/^#EXT-X-STREAM-INF:/iu.test(lines[i])) continue;
    const resolution = lines[i].match(/\bRESOLUTION=(\d+)x(\d+)/iu);
    for (let j = i + 1; j < lines.length; j += 1) {
      const uri = lines[j].trim();
      if (!uri || uri.startsWith('#')) continue;
      let url: string | null = null;
      try {
        url = new URL(uri, base).href;
      } catch {
        break;
      }
      if (!url || !/^https?:/iu.test(url) || out.some((v) => v.url === url)) {
        break;
      }
      const item: ScannedVideo = { url, type: 'm3u8' };
      if (resolution) {
        const width = Number(resolution[1]);
        const height = Number(resolution[2]);
        if (width > 0 && height > 0) {
          item.width = width;
          item.height = height;
        }
      }
      out.push(item);
      break;
    }
  }
  return out;
}

export interface HlsResult {
  url: string;
  videos: ScannedVideo[];
}

export function parseHlsMessage(raw: string): HlsResult | null {
  try {
    const data = JSON.parse(raw) as { type?: string; data?: HlsResult };
    if (
      data.type !== 'hls' ||
      !data.data ||
      !data.data.url ||
      !Array.isArray(data.data.videos)
    ) {
      return null;
    }
    return data.data;
  } catch {
    return null;
  }
}

// runs inside the page; DOM access only, never imported by node tests.
// scans keep running while the page is alive: slow SPAs (ok.ru et al) start
// players long after first paint, so the host settles on quiet, not a clock
export const SNIFFER_JS = `(() => {
  const post = (m) => {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ id: window.__phantom_scan_id }, m))); } catch (e) {}
  };
  window.__phantom_failed_probes = window.__phantom_failed_probes || [];
  const failed = (u) => window.__phantom_failed_probes.indexOf(u) !== -1;
  const strict = (u) => /${MEDIA_RE.source}/i.test(u || '');
  const wide = (u) => /${MEDIA_WIDE_RE.source}/i.test(u || '');
  const junk = (u) => /${MEDIA_JUNK_RE.source}/i.test(u || '');
  const collect = () => {
    const out = { url: location.href, title: document.title, videos: [], images: [], cookies: document.cookie };
    // same-origin iframe players (ok.ru/videoembed) are invisible from here
    const wins = [window];
    for (let i = 0; i < window.frames.length; i++) {
      try { wins.push(window.frames[i]); } catch (e) {}
    }
    let wideCount = 0;
    wins.forEach((win) => {
      let doc, base;
      try { doc = win.document; base = win.location.href; } catch (e) { return; }
      const abs = (u) => {
        try { return new URL(u, base).href; } catch (e) { return null; }
      };
      const push = (src, el, list, allowWide) => {
        const url = abs(src);
        if (!url || !/^https?:/i.test(url) || failed(url) || junk(url)) return;
        if (list.some((v) => v.url === url)) return;
        if (list.length >= 12) return;
        if (!strict(url) && !(allowWide && wide(url) && wideCount++ < 8)) return;
        const item = { url };
        if (el && el.poster) item.poster = el.poster;
        if (el && el.type) item.type = el.type;
        if (el && el.videoWidth > 0) {
          item.width = el.videoWidth;
          item.height = el.videoHeight;
        }
        list.push(item);
      };
      doc.querySelectorAll('video').forEach((v) => {
        push(v.currentSrc || v.src, v, out.videos, true);
        if (v.currentSrc) push(v.src, v, out.videos, true);
      });
      doc.querySelectorAll('video source').forEach((s) => push(s.src, s, out.videos, true));
      doc.querySelectorAll('a[href]').forEach((a) => {
        if (strict(a.href)) push(a.href, null, out.videos, false);
      });
      // player fetches (XHR/fetch) never hit the RN webview load events: the real
      // stream url lives in the resource timing buffer instead
      if (win.performance && win.performance.getEntriesByType) {
        win.performance
          .getEntriesByType('resource')
          .forEach((entry) => push(entry.name, null, out.videos, true));
      }
      // click-gated players never fetch: harvest media urls from the page's
      // embedded state (__PRELOADED_STATE__ etc) + og tags, probe verifies
      if (doc.documentElement) {
        const html = doc.documentElement.outerHTML.slice(0, 250000);
        const embedded = html.match(/https?:\\/\\/[^"'<>\\\\ ]+?\\.(?:mp4|webm|m3u8|mov)(?:[?#][^"'<>\\\\ ]*)?/gi) || [];
        embedded.forEach((u) => push(u, null, out.videos, true));
        doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[itemprop="contentUrl"]').forEach((m) => {
          if (m.content) push(m.content, null, out.videos, true);
        });
      }
      const seenImages = new Set();
      doc.querySelectorAll('img').forEach((img) => {
        if (out.images.length >= 12) return;
        if (img.src && /^https?:/i.test(img.src) && !junk(img.src)) {
          const url = abs(img.src);
          if (url && !seenImages.has(url)) {
            seenImages.add(url);
            out.images.push({ url });
          }
        }
      });
      const og = doc.querySelector('meta[property="og:image"]');
      if (og && og.content && !out.ogImage) out.ogImage = abs(og.content);
      const link = doc.querySelector('link[rel="image_src"]');
      if (!out.ogImage && link && link.href) out.ogImage = abs(link.href);
    });
    post({ type: 'pageScan', data: out });
  };
  // dims for streams the page fetched off-screen (xhr/tumblr) or direct pastes:
  // play a hidden metadata-only element, browser reads headers for us. failures
  // are remembered so later scans drop the junk
  const probe = (u) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = u;
    v.style.display = 'none';
    v.onloadedmetadata = () => setTimeout(collect, 300);
    v.onerror = () => {
      window.__phantom_failed_probes.push(u);
      setTimeout(collect, 300);
    };
    document.body.appendChild(v);
  };
  // m3u8 manifests can't be read by a <video> element: fetch them same-origin
  // and parse variants (ok.ru, live HLS sites). dead manifests join the failed
  // list so later scans drop them
  function hlsVideosOf(text, base) {
    const manifest = (text || '').trim();
    if (!/^#EXTM3U/iu.test(manifest)) return [];
    const lines = manifest.split(/\\r?\\n/);
    if (lines.some((line) => /^#EXTINF:/iu.test(line))) return [{ url: base, type: 'm3u8' }];
    const out = [];
    for (let i = 0; i < lines.length && out.length < 12; i += 1) {
      if (!/^#EXT-X-STREAM-INF:/iu.test(lines[i])) continue;
      const resolution = lines[i].match(/\\bRESOLUTION=(\\d+)x(\\d+)/iu);
      for (let j = i + 1; j < lines.length; j += 1) {
        const uri = lines[j].trim();
        if (!uri || uri.startsWith('#')) continue;
        let url = null;
        try { url = new URL(uri, base).href; } catch (e) { break; }
        if (!url || !/^https?:/iu.test(url) || out.some((v) => v.url === url)) break;
        const item = { url, type: 'm3u8' };
        if (resolution) {
          const width = Number(resolution[1]);
          const height = Number(resolution[2]);
          if (width > 0 && height > 0) { item.width = width; item.height = height; }
        }
        out.push(item);
        break;
      }
    }
    return out;
  }
  window.__phantom_hls_seen = window.__phantom_hls_seen || [];
  const hls = (u) => {
    if (window.__phantom_hls_seen.indexOf(u) !== -1) return;
    window.__phantom_hls_seen.push(u);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', u, true);
    xhr.timeout = 8000;
    xhr.onload = () => {
      const videos = hlsVideosOf(xhr.responseText || '', u);
      if (videos.length === 0) {
        if (!failed(u)) window.__phantom_failed_probes.push(u);
        post({ type: 'hls', data: { url: u, videos: [] } });
      } else {
        post({ type: 'hls', data: { url: u, videos } });
        setTimeout(collect, 300);
      }
    };
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => {
      if (!failed(u)) window.__phantom_failed_probes.push(u);
      post({ type: 'hls', data: { url: u, videos: [] } });
    };
    xhr.send(null);
  };
  window.__phantom_collect = collect;
  window.__phantom_probe = probe;
  window.__phantom_hls = hls;
  window.addEventListener('load', () => setTimeout(collect, 250));
  const timer = setInterval(collect, 1200);
  setTimeout(() => clearInterval(timer), 30000);
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
