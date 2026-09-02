import { Format, VideoInfo, ExtractorOptions } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { DESKTOP_UA } from './util.js';
import { notFound, noVideo, fromStatus, classifyThrown, temporaryError, ExtractorError } from './errors.js';

const API = 'https://api-v2.soundcloud.com';
const REFERER = 'https://soundcloud.com/';
const CLIENT_ID_TTL = 3600000;

let cachedClientId: string | null = null;
let clientIdAt = 0;

async function getClientId(env: ExtractorEnv): Promise<string | null> {
  if (cachedClientId && Date.now() - clientIdAt < CLIENT_ID_TTL) return cachedClientId;
  try {
    const res = await env.fetch('https://soundcloud.com/', { headers: { 'User-Agent': DESKTOP_UA } });
    const html = await res.text();
    const scripts = [...html.matchAll(/src="(https:\/\/[^"]+\/assets\/[^"]+\.js)"/gu)].map((m) => m[1]).reverse();
    for (const src of scripts) {
      const body = await (await env.fetch(src, { headers: { 'User-Agent': DESKTOP_UA } })).text();
      const id = body.match(/client_id:"([a-zA-Z0-9]{32})"/u);
      if (id) {
        cachedClientId = id[1];
        clientIdAt = Date.now();
        return cachedClientId;
      }
    }
  } catch {
    /* fall through */
  }
  return cachedClientId;
}

export function prewarmClientId(env: ExtractorEnv = defaultEnv): void {
  void getClientId(env);
}

interface Transcoding {
  url: string;
  format: { protocol: string; mime_type: string };
}
interface Track {
  policy?: string;
  duration?: number;
  full_duration?: number;
  title?: string;
  media?: { transcodings?: Transcoding[] };
  id?: string | number;
  user?: { username?: string; avatar_url?: string };
  artwork_url?: string;
  publisher_metadata?: { isrc?: string; artist?: string; album_title?: string; release_title?: string };
}

function pickThumbnail(track: Track): string | undefined {
  const art = track.artwork_url || track.user?.avatar_url;
  return art ? art.replace('-large', '-t500x500') : undefined;
}
function isEncrypted(tr: Transcoding): boolean {
  return tr.format.protocol.includes('encrypted');
}
function pickTranscodings(track: Track): Transcoding[] {
  const list = (track.media?.transcodings ?? []).filter((tr) => !isEncrypted(tr));
  const rank = (tr: Transcoding): number => {
    if (tr.format.protocol === 'progressive') return 0;
    if (tr.format.protocol === 'hls' && tr.format.mime_type.includes('mp4')) return 1;
    if (tr.format.protocol === 'hls') return 2;
    return 3;
  };
  return list.sort((a, b) => rank(a) - rank(b));
}
function drmProtected(): ExtractorError {
  return new ExtractorError('This SoundCloud track is DRM-protected by its label and can\u2019t be downloaded.', false, true);
}
async function permalink(env: ExtractorEnv, url: string): Promise<string> {
  if (!/on\.soundcloud\.com/iu.test(url)) return url;
  try {
    const res = await env.fetch(url, { headers: { 'User-Agent': DESKTOP_UA }, redirect: 'manual' } as RequestInit);
    const loc = (res.headers as unknown as { get: (k: string) => string | null })?.get?.('location');
    if (loc) return loc;
    if ((res as unknown as { url: string }).url && (res as unknown as { url: string }).url !== url) return (res as unknown as { url: string }).url;
  } catch { /* fall through */ }
  try {
    const res = await env.fetch(url, { headers: { 'User-Agent': DESKTOP_UA }, redirect: 'follow' } as RequestInit);
    return (res as unknown as { url: string }).url || url;
  } catch { return url; }
}
function assertNotSnippet(track: Track): void {
  const dur = track.duration ?? 0;
  const full = track.full_duration ?? 0;
  if (track.policy === 'SNIPPET' || (dur < 60000 && full > 60000)) {
    throw new ExtractorError("This SoundCloud track is a preview only — the full track isn't available to download.", false);
  }
}
async function resolveStreamUrl(env: ExtractorEnv, candidates: Transcoding[], clientId: string): Promise<{ streamUrl?: string; picked?: Transcoding; lastStatus: number }> {
  let lastStatus = 0;
  for (const c of candidates) {
    const res = await env.fetch(`${c.url}?client_id=${clientId}`, { headers: { 'User-Agent': DESKTOP_UA } });
    if (!res.ok) {
      lastStatus = res.status;
      if (res.status === 404 || res.status === 403) continue;
      throw fromStatus(res.status, 'SoundCloud', 'track');
    }
    const { url } = (await res.json()) as { url?: string };
    if (url) return { streamUrl: url, picked: c, lastStatus };
  }
  return { lastStatus };
}
async function buildAudioFormat(env: ExtractorEnv, streamUrl: string, isHls: boolean): Promise<Format> {
  let filesize: number | undefined;
  if (!isHls) {
    try {
      const head = await env.fetch(streamUrl, { method: 'HEAD', headers: { 'User-Agent': DESKTOP_UA } } as RequestInit);
      const len = head.headers.get('content-length');
      if (len) filesize = parseInt(len, 10);
    } catch { /* optional */ }
  }
  return {
    formatId: 'audio',
    url: streamUrl,
    extension: isHls ? 'm4a' : 'mp3',
    quality: 'Audio',
    acodec: isHls ? 'aac' : 'mp3',
    filesize,
    isAudio: true,
    isVideo: false,
    isMuxed: false,
    isHls: isHls || undefined,
    noTranscode: isHls ? undefined : true,
  };
}

export function createSoundCloudExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, options: ExtractorOptions & { onPartial?: (info: VideoInfo) => void } = {}): Promise<VideoInfo | null> {
    const onPartial = (options as { onPartial?: (info: VideoInfo) => void }).onPartial;
    const target = await permalink(env, url);
    const clientId = await getClientId(env);
    if (!clientId) throw temporaryError('SoundCloud', 'track');
    const resolved = await env.fetch(`${API}/resolve?url=${encodeURIComponent(target)}&client_id=${clientId}`, { headers: { 'User-Agent': DESKTOP_UA } });
    if (!resolved.ok) {
      if (resolved.status === 404) throw notFound('SoundCloud', 'track');
      throw fromStatus(resolved.status, 'SoundCloud', 'track');
    }
    const track = (await resolved.json()) as Track;
    assertNotSnippet(track);
    const all = track.media?.transcodings ?? [];
    const candidates = pickTranscodings(track);
    if (candidates.length === 0) {
      if (all.some(isEncrypted)) throw drmProtected();
      throw noVideo('SoundCloud', 'track');
    }
    const meta = {
      id: String(track.id ?? target),
      title: track.title || 'SoundCloud Audio',
      uploader: track.user?.username || 'SoundCloud',
      thumbnail: pickThumbnail(track),
      duration: track.duration ? Math.round(track.duration / 1000) : undefined,
    };
    const partial: VideoInfo = {
      type: 'video',
      id: meta.id,
      title: meta.title,
      uploader: meta.uploader,
      webpageUrl: target,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      formats: [],
      extractorKey: 'soundcloud',
      isJsInfo: true,
      fromBrain: false,
      isPartial: true,
      isIsrcMatch: false,
      isFullData: false,
      downloadHeaders: { 'User-Agent': DESKTOP_UA },
    };
    onPartial?.(partial);
    const { streamUrl, picked, lastStatus } = await resolveStreamUrl(env, candidates, clientId);
    if (!streamUrl || !picked) {
      if (all.some(isEncrypted)) throw drmProtected();
      if (lastStatus) throw fromStatus(lastStatus, 'SoundCloud', 'track');
      throw noVideo('SoundCloud', 'track');
    }
    const isHls = picked.format.protocol === 'hls';
    const format = await buildAudioFormat(env, streamUrl, isHls);
    return {
      type: 'video',
      id: meta.id,
      title: meta.title,
      uploader: meta.uploader,
      webpageUrl: target,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      formats: [format],
      extractorKey: 'soundcloud',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: false,
      downloadHeaders: { 'User-Agent': DESKTOP_UA },
    };
  }

  async function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const selected = videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!selected?.url) throw new Error('No stream URL found');
    if (selected.isHls || selected.url.includes('.m3u8')) {
      if (!env.remuxHls) throw new Error('HLS needs remuxHls');
      return env.remuxHls(selected.url, {});
    }
    return env.streamUrl(selected.url, {});
  }

  async function search(query: string): Promise<unknown[]> {
    const clientId = await getClientId(env);
    if (!clientId) return [];
    try {
      const res = await env.fetch(`${API}/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=5`);
      const { collection } = (await res.json()) as { collection?: unknown[] };
      return collection ?? [];
    } catch { return []; }
  }

  return { getInfo, getStream, search, prewarm: () => prewarmClientId(env) };
}
