import { VideoInfo, Format } from './types';
import { gatedFetch, mapLimit } from '../lib/net';
import { noVideo, classifyThrown } from './errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, log } from '../lib/log';
import { parseHlsMaster, pickLargestThumb } from './hls';
import { probeFileSize } from './social';
import { buildVideoInfo } from './videoInfo';
const REFERER = 'https://vimeo.com/';

// flip true to trace config/player-page on-device
const VM_DEBUG = false;
const vlog = (...args: unknown[]): void => {
  if (VM_DEBUG) log('vimeo', '[JS-Vimeo]', ...args);
};

interface Progressive {
  quality?: string;
  width?: number;
  height?: number;
  url: string;
}
interface VimeoConfig {
  video?: {
    id?: number | string;
    title?: string;
    duration?: number;
    owner?: { name?: string };
    thumbs?: Record<string, string>;
  };
  request?: {
    files?: {
      progressive?: Progressive[];
      hls?: { default_cdn?: string; cdns?: Record<string, { url?: string }> };
    };
  };
}

interface VmMeta {
  id: string;
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

function buildInfo(meta: VmMeta, url: string, formats: Format[]): VideoInfo {
  return buildVideoInfo({
    id: meta.id,
    title: meta.title || 'Vimeo Video',
    uploader: meta.uploader || 'Vimeo',
    webpageUrl: url,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    formats,
    extractorKey: 'vimeo',
    downloadHeaders: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
  });
}

function parseId(url: string): { id: string; hash?: string } | null {
  const match = url.match(
    /(?:player\.vimeo\.com\/video\/|vimeo\.com\/(?:video\/)?)(\d+)(?:\/([a-z0-9]+))?/iu
  );
  return match ? { id: match[1], hash: match[2] } : null;
}

// brace-match json embedded in html/js
function sliceJson(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k += 1) {
    const ch = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, k + 1);
    }
  }
  return null;
}

// restricted videos 403 /config but embed window.playerConfig in player page
async function playerPageConfig(
  id: string,
  hash?: string
): Promise<VimeoConfig | null> {
  const query = hash ? `?h=${hash}` : '';
  const res = await gatedFetch(`https://player.vimeo.com/video/${id}${query}`, {
    headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
  });
  vlog('player page', res.status);
  if (!res.ok) return null;
  const html = await res.text();
  const at = html.indexOf('window.playerConfig');
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  const json = open >= 0 ? sliceJson(html, open) : null;
  if (!json) return null;
  try {
    return JSON.parse(json) as VimeoConfig;
  } catch {
    return null;
  }
}

async function fetchConfig(
  id: string,
  hash?: string
): Promise<VimeoConfig | null> {
  const query = hash ? `?h=${hash}` : '';
  const res = await gatedFetch(
    `https://player.vimeo.com/video/${id}/config${query}`,
    { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } }
  );
  vlog('config ep', res.status);
  if (res.ok) return (await res.json()) as VimeoConfig;
  if (hash) return playerPageConfig(id, hash);
  return null;
}

// some videos gate config behind page-only hash
async function pageHash(id: string, url: string): Promise<string | undefined> {
  try {
    const page = url.startsWith('http') ? url : `https://vimeo.com/${id}`;
    const res = await gatedFetch(page, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const re = new RegExp(
      `player\\.vimeo\\.com/video/${id}\\?h=([a-z0-9]+)`,
      'iu'
    );
    return html.match(re)?.[1];
  } catch {
    return undefined;
  }
}

function buildFormats(progressive: Progressive[]): Format[] {
  const seen = new Set<string>();
  const formats: Format[] = [];
  for (const prog of progressive) {
    if (!prog.url) continue;
    const quality = prog.quality || (prog.height ? `${prog.height}p` : 'src');
    if (seen.has(quality)) continue;
    seen.add(quality);
    formats.push({
      formatId: quality,
      url: prog.url,
      extension: 'mp4',
      resolution:
        prog.width && prog.height ? `${prog.width}x${prog.height}` : undefined,
      quality,
      width: prog.width,
      height: prog.height,
      vcodec: 'h264',
      acodec: 'aac',
      isVideo: true,
      isAudio: false,
      isMuxed: true,
    });
  }
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

// playerConfig often lacks thumbs; oembed always carries one
async function oembedThumb(url: string): Promise<string | undefined> {
  try {
    const res = await gatedFetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
      { headers: { 'User-Agent': DESKTOP_UA } }
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { thumbnail_url?: string };
    return data.thumbnail_url;
  } catch {
    return undefined;
  }
}

// old videos: config thumbs empty & oembed gone — page og:image still there
async function ogImageThumb(url: string): Promise<string | undefined> {
  try {
    const res = await gatedFetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const match =
      /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/iu.exec(
        html
      );
    return match?.[1]?.replace(/&amp;/gu, '&') ?? undefined;
  } catch {
    return undefined;
  }
}

async function viaConfig(
  ref: { id: string; hash?: string },
  url: string
): Promise<VideoInfo | null> {
  let cfg = await fetchConfig(ref.id, ref.hash);
  if (!cfg && !ref.hash) {
    const hash = await pageHash(ref.id, url);
    vlog('pageHash', hash);
    if (hash) cfg = await fetchConfig(ref.id, hash);
  }
  vlog('config', cfg ? 'ok' : 'null');
  if (!cfg) throw noVideo('Vimeo');
  const files = cfg.request?.files;

  const formats = buildFormats(files?.progressive ?? []);
  if (formats.length === 0) {
    const cdn = files?.hls?.cdns?.[files.hls.default_cdn ?? ''];
    if (cdn?.url) {
      const headers = { 'User-Agent': DESKTOP_UA, Referer: REFERER };
      const variants = await parseHlsMaster(
        cdn.url,
        cfg.video?.duration ?? 0,
        headers
      );
      if (variants.length) formats.push(...variants);
      else
        formats.push({
          formatId: 'auto',
          url: cdn.url,
          extension: 'mp4',
          quality: 'Auto',
          vcodec: 'h264',
          acodec: 'aac',
          isVideo: true,
          isAudio: false,
          isMuxed: true,
          isHls: true,
          hlsKeepAlive: true,
        });
    }
  }
  if (formats.length === 0) throw noVideo('Vimeo');

  // config carries no size; HEAD each quality
  await mapLimit(formats, 3, async (format) => {
    if (format.isHls) return;
    const size = await probeFileSize(format.url, {
      'User-Agent': DESKTOP_UA,
      Referer: REFERER,
    });
    if (size) format.filesize = size;
  });

  const video = cfg.video;
  let thumbnail = pickLargestThumb(video?.thumbs);
  if (!thumbnail) thumbnail = await oembedThumb(url);
  if (!thumbnail) thumbnail = await ogImageThumb(url);
  return buildInfo(
    {
      id: String(video?.id ?? ref.id),
      title: video?.title,
      uploader: video?.owner?.name,
      duration: video?.duration,
      thumbnail,
    },
    url,
    formats
  );
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const ref = parseId(url);
    if (!ref) return null;
    return await viaConfig(ref, url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('vimeo', `[JS-Vimeo] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Vimeo');
  }
}
