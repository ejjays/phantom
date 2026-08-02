import { spawn } from 'node:child_process';
import { logger } from '../../utils/infra/logger.util.js';
import { Readable } from 'node:stream';
import { secureFetch } from '../../utils/network/security.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../types/index.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://vimeo.com/';

// flip true to trace config/player-page resolution
const VM_DEBUG = false;
const vlog = (...args: unknown[]): void => {
  if (VM_DEBUG) logger.info('[JS-Vimeo]', ...args);
};

interface Progressive {
  quality?: string;
  width?: number;
  height?: number;
  fps?: number;
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
  return {
    type: 'video',
    id: meta.id,
    title: meta.title || 'Vimeo Video',
    uploader: meta.uploader || 'Vimeo',
    webpageUrl: url,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    formats,
    extractorKey: 'vimeo',
    isJsInfo: true,
    fromBrain: false,
    isPartial: false,
    isIsrcMatch: false,
    isFullData: true,
  };
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
  for (let idx = start; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, idx + 1);
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
  const res = await secureFetch(
    `https://player.vimeo.com/video/${id}${query}`,
    {
      headers: { 'User-Agent': UA, Referer: REFERER },
    }
  );
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
  const res = await secureFetch(
    `https://player.vimeo.com/video/${id}/config${query}`,
    { headers: { 'User-Agent': UA, Referer: REFERER } }
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
    const res = await secureFetch(page, { headers: { 'User-Agent': UA } });
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

function pickThumb(thumbs?: Record<string, string>): string | undefined {
  if (!thumbs) return undefined;
  const sized = Object.entries(thumbs)
    .filter(([key]) => /^\d+$/u.test(key))
    .sort((lhs, rhs) => Number(rhs[0]) - Number(lhs[0]));
  return sized[0]?.[1] ?? thumbs.base ?? Object.values(thumbs)[0];
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
      fps: prog.fps,
      vcodec: 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: false,
    });
  }
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

async function viaConfig(
  ref: { id: string; hash?: string },
  url: string
): Promise<VideoInfo | null> {
  let cfg = await fetchConfig(ref.id, ref.hash);
  // hash-gated pasted bare -> scrape page hash
  if (!cfg && !ref.hash) {
    const hash = await pageHash(ref.id, url);
    vlog('pageHash', hash);
    if (hash) cfg = await fetchConfig(ref.id, hash);
  }
  vlog('config', cfg ? 'ok' : 'null');
  if (!cfg) return null;
  const files = cfg.request?.files;

  const formats = buildFormats(files?.progressive ?? []);
  // no progressive -> adaptive hls remux
  if (formats.length === 0) {
    const hls = files?.hls;
    const cdn = hls?.cdns?.[hls.default_cdn ?? ''];
    if (cdn?.url) {
      formats.push({
        formatId: 'auto',
        url: cdn.url,
        extension: 'mp4',
        quality: 'Auto',
        vcodec: 'h264',
        acodec: 'aac',
        isMuxed: true,
        isVideo: true,
        isAudio: false,
        note: 'hls m3u8',
      });
    }
  }
  if (formats.length === 0) return null;

  const video = cfg.video;
  return buildInfo(
    {
      id: String(video?.id ?? ref.id),
      title: video?.title,
      uploader: video?.owner?.name,
      duration: video?.duration,
      thumbnail: pickThumb(video?.thumbs),
    },
    url,
    formats
  );
}

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const ref = parseId(url);
    if (!ref) return null;
    return await viaConfig(ref, url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[JS-Vimeo] Error extracting ${url}: ${message}`);
    return null;
  }
}

export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const selected =
    videoInfo.formats.find(
      (format) => String(format.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!selected?.url) throw new Error('No stream URL found');

  // progressive direct mp4; only hls needs remux
  if (selected.note?.includes('hls') || selected.url.includes('.m3u8')) {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        UA,
        '-i',
        selected.url,
        '-c',
        'copy',
        '-bsf:a',
        'aac_adtstoasc',
        '-f',
        'mp4',
        '-movflags',
        '+frag_keyframe+empty_moov+default_base_moof',
        '-frag_duration',
        '1000000',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    (ffmpeg.stdio[2] as Readable | null)?.resume();
    ffmpeg.on('error', (err: Error) =>
      logger.error(`[JS-Vimeo] ffmpeg error: ${err.message}`)
    );
    return Promise.resolve(ffmpeg.stdout as Readable);
  }

  return Promise.resolve(getProxiedStream(selected.url, {}));
}
