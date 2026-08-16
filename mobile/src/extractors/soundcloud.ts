import { VideoInfo, Format, ExtractorError } from './types';
import { gatedFetch } from '../lib/net';
import { probeFileSize } from './social';
import { noVideo, fromStatus, temporaryError, classifyThrown } from './errors';
import { getScClientId, setScClientId } from '../lib/settings';
import { DESKTOP_UA } from '../lib/userAgents';
import { buildVideoInfo } from './videoInfo';
import {
  resolveViaYoutube,
  buildFromYoutube,
  partialFromMeta,
  type IsrcMatchMeta,
} from './youtube/isrcMatch';
import { error as logError, log } from '../lib/log';

const API = 'https://api-v2.soundcloud.com';
const CLIENT_ID_TTL = 3600000;

const SC_DEBUG = false;
function dbg(...parts: unknown[]): void {
  if (SC_DEBUG) log('soundcloud', '[JS-SoundCloud]', ...parts);
}

let cachedClientId: string | null = null;
let clientIdAt = 0;

/**
 * soundcloud ships no public api key, so client_id is scraped
 * from homepage's assets bundle. rotates → cache 1h.
 */
async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - clientIdAt < CLIENT_ID_TTL) {
    return cachedClientId;
  }
  const stored = await getScClientId();
  if (stored && Date.now() - stored.at < CLIENT_ID_TTL) {
    cachedClientId = stored.id;
    clientIdAt = stored.at;
    return cachedClientId;
  }
  try {
    const res = await gatedFetch('https://soundcloud.com/', {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    const html = await res.text();
    const scripts = [
      ...html.matchAll(/src="(https:\/\/[^"]+\/assets\/[^"]+\.js)"/gu),
    ]
      .map((hit) => hit[1])
      .reverse();
    for (const src of scripts) {
      const body = await (
        await gatedFetch(src, { headers: { 'User-Agent': DESKTOP_UA } })
      ).text();
      const id = body.match(/client_id:"([a-zA-Z0-9]{32})"/u);
      if (id) {
        cachedClientId = id[1];
        clientIdAt = Date.now();
        void setScClientId(cachedClientId);
        return cachedClientId;
      }
    }
  } catch {
    /* fall through to cached */
  }
  return cachedClientId;
}

// warm client_id at startup; unblocks first resolve
export function prewarmClientId(): void {
  void getClientId();
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
  publisher_metadata?: {
    isrc?: string;
    artist?: string;
    album_title?: string;
    release_title?: string;
  };
}

function pickThumbnail(track: Track): string | undefined {
  const art = track.artwork_url || track.user?.avatar_url;
  return art ? art.replace('-large', '-t500x500') : undefined;
}

function isEncrypted(tr: Transcoding): boolean {
  return tr.format.protocol.includes('encrypted');
}

/**
 * ordered candidates, best first. major-label tracks list plain
 * progressive/hls transcodings that 404 at stream-resolve, so callers
 * must be ready to fall through the whole list.
 */
function pickTranscodings(track: Track): Transcoding[] {
  const list = (track.media?.transcodings ?? []).filter(
    (tr) => !isEncrypted(tr)
  );
  const rank = (tr: Transcoding): number => {
    if (tr.format.protocol === 'progressive') return 0;
    if (tr.format.protocol === 'hls' && tr.format.mime_type.includes('mp4'))
      return 1;
    if (tr.format.protocol === 'hls') return 2;
    return 3;
  };
  return list.sort((left, right) => rank(left) - rank(right));
}

function drmProtected(): ExtractorError {
  return new ExtractorError(
    'This SoundCloud track is DRM-protected by its label and can\u2019t be downloaded.',
    false,
    true
  );
}

/**
 * label-locked track → the audio file itself is FairPlay/Widevine DRM and
 * can't be decrypted, but labels register an isrc in publisher_metadata.
 * reuse the same youtube isrc-match pipeline the spotify extractor uses to
 * fetch the identical recording from youtube. returns null when there's
 * nothing to search with, or no match is found → caller falls back to the
 * honest DRM error.
 */
async function drmFallback(
  track: Track,
  webpageUrl: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  const pm = track.publisher_metadata;
  const title = pm?.release_title || track.title;
  const artist = pm?.artist || track.user?.username;
  if (!title || !artist) return null;

  const meta: IsrcMatchMeta = {
    id: String(track.id ?? webpageUrl),
    title,
    artist,
    album: pm?.album_title,
    cover: pickThumbnail(track),
    durationMs: track.full_duration || track.duration || 0,
    isrc: pm?.isrc,
  };
  onPartial?.(partialFromMeta(meta, webpageUrl, 'soundcloud'));

  const videoUrl = await resolveViaYoutube(meta);
  if (!videoUrl) return null;
  dbg('DRM \u2192 youtube match', videoUrl, `isrc=${meta.isrc || 'none'}`);
  return buildFromYoutube(meta, webpageUrl, videoUrl, 'soundcloud');
}

// on.soundcloud links 302; read Location manually (faster than full follow)
async function permalink(url: string): Promise<string> {
  if (!/on\.soundcloud\.com/iu.test(url)) return url;
  try {
    const res = await gatedFetch(url, {
      headers: { 'User-Agent': DESKTOP_UA },
      redirect: 'manual',
    });
    const loc = res.headers?.get('location');
    dbg('permalink', loc ? 'via location' : 'no location', res.status);
    if (loc) return loc;
    if (res.url && res.url !== url) return res.url;
  } catch {
    /* fall through to full follow */
  }
  try {
    const res = await gatedFetch(url, {
      headers: { 'User-Agent': DESKTOP_UA },
      redirect: 'follow',
    });
    return res.url || url;
  } catch {
    return url;
  }
}

interface ScMeta {
  id: string;
  title: string;
  uploader: string;
  thumbnail?: string;
  duration?: number;
}

function buildInfo(
  meta: ScMeta,
  webpageUrl: string,
  formats: Format[],
  partial: boolean
): VideoInfo {
  return buildVideoInfo({
    id: meta.id,
    title: meta.title,
    uploader: meta.uploader,
    webpageUrl,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    formats,
    extractorKey: 'soundcloud',
    isPartial: partial,
    downloadHeaders: { 'User-Agent': DESKTOP_UA },
  });
}

// label tracks 404 at stream-resolve; fall through ranked list
async function resolveStreamUrl(
  candidates: Transcoding[],
  clientId: string
): Promise<{ streamUrl?: string; picked?: Transcoding; lastStatus: number }> {
  let lastStatus = 0;
  for (const candidate of candidates) {
    const streamRes = await gatedFetch(
      `${candidate.url}?client_id=${clientId}`,
      {
        headers: { 'User-Agent': DESKTOP_UA },
      }
    );
    dbg('stream resolve', candidate.format.protocol, streamRes.status);
    if (!streamRes.ok) {
      lastStatus = streamRes.status;
      // 404/403 here = this transcoding is dead, not the track; try next
      if (streamRes.status === 404 || streamRes.status === 403) continue;
      throw fromStatus(streamRes.status, 'SoundCloud', 'track');
    }
    const { url: resolvedUrl } = (await streamRes.json()) as { url?: string };
    if (resolvedUrl) {
      return { streamUrl: resolvedUrl, picked: candidate, lastStatus };
    }
  }
  return { lastStatus };
}

// label-locked: only encrypted streams resolve → isrc-match youtube, else honest drm error
async function recoverDrm(
  track: Track,
  webpageUrl: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo> {
  const viaIsrc = await drmFallback(track, webpageUrl, onPartial);
  if (viaIsrc) return viaIsrc;
  throw drmProtected();
}

// preview snippet, not the full track
function assertNotSnippet(track: Track): void {
  const dur = track.duration ?? 0;
  const full = track.full_duration ?? 0;
  if (track.policy === 'SNIPPET' || (dur < 60000 && full > 60000)) {
    throw new ExtractorError(
      "This SoundCloud track is a preview only — the full track isn't available to download.",
      false
    );
  }
}

/**
 * progressive = native mp3 (no transcode); hls = aac wrapped in m4a.
 */
async function buildAudioFormat(
  streamUrl: string,
  isHls: boolean
): Promise<Format> {
  let filesize: number | undefined;
  if (!isHls) {
    const size = await probeFileSize(streamUrl, {
      'User-Agent': DESKTOP_UA,
    });
    if (size) filesize = size;
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

export async function getInfo(
  url: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  try {
    const t0 = Date.now();
    const [clientId, target] = await Promise.all([
      getClientId(),
      permalink(url),
    ]);
    if (!clientId) throw temporaryError('SoundCloud', 'track');
    dbg('id+permalink', `${Date.now() - t0}ms`);

    const resolved = await gatedFetch(
      `${API}/resolve?url=${encodeURIComponent(target)}&client_id=${clientId}`,
      { headers: { 'User-Agent': DESKTOP_UA } }
    );
    if (!resolved.ok) throw fromStatus(resolved.status, 'SoundCloud', 'track');
    const track = (await resolved.json()) as Track;
    dbg('resolve', resolved.status, `${Date.now() - t0}ms`);

    assertNotSnippet(track);

    const allTranscodings = track.media?.transcodings ?? [];
    const candidates = pickTranscodings(track);
    if (!candidates.length) {
      if (allTranscodings.some(isEncrypted)) {
        return recoverDrm(track, target, onPartial);
      }
      throw noVideo('SoundCloud', 'track');
    }

    const meta: ScMeta = {
      id: String(track.id ?? target),
      title: track.title || 'SoundCloud Audio',
      uploader: track.user?.username || 'SoundCloud',
      thumbnail: pickThumbnail(track),
      duration: track.duration ? Math.round(track.duration / 1000) : undefined,
    };
    // paint picker now; stream resolve + HEAD pending
    onPartial?.(buildInfo(meta, target, [], true));
    dbg('partial paint', `${Date.now() - t0}ms`);

    const { streamUrl, picked, lastStatus } = await resolveStreamUrl(
      candidates,
      clientId
    );
    if (!streamUrl || !picked) {
      if (allTranscodings.some(isEncrypted)) {
        return recoverDrm(track, target, onPartial);
      }
      if (lastStatus) throw fromStatus(lastStatus, 'SoundCloud', 'track');
      throw noVideo('SoundCloud', 'track');
    }

    const isHls = picked.format.protocol === 'hls';
    const format = await buildAudioFormat(streamUrl, isHls);

    dbg('full', `${Date.now() - t0}ms`);
    return buildInfo(meta, target, [format], false);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(
      'soundcloud',
      `[JS-SoundCloud] Error extracting ${url}: ${message}`
    );
    throw classifyThrown(error, 'SoundCloud', 'track');
  }
}
