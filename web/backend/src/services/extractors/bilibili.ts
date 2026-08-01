import { Readable } from 'node:stream';
import { VideoInfo, Format, ExtractorOptions } from '../../types/index.js';
import { secureFetch } from '../../utils/network/security.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import {
  processVideoFormats,
  processAudioFormats,
  RawFormat,
} from '../../utils/media/format.util.js';
import { normalizeTitle, normalizeArtist } from '../social.service.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// bstar (not mainland); cookie unlocks HD-gated streams
const PLAYURL_API = 'https://api.bilibili.tv/intl/gateway/web/playurl';
const REFERER = 'https://www.bilibili.tv/';

function biliCookieHeader(): Record<string, string> {
  const cookie = process.env.BILIBILI_COOKIE?.trim();
  return cookie ? { Cookie: cookie } : {};
}

interface BiliResource {
  id?: string;
  quality?: number;
  bandwidth?: number;
  codecs?: string;
  size?: number;
  url?: string;
  width?: number;
  height?: number;
  frame_rate?: string;
  mime_type?: string;
}
interface BiliVideoEntry {
  video_resource?: BiliResource;
  stream_info?: { quality?: number; desc_words?: string };
}
interface BiliPlayurl {
  duration?: number;
  video?: BiliVideoEntry[];
  audio_resource?: BiliResource[];
}
interface BiliPlayurlResponse {
  code?: number;
  message?: string;
  data?: { playurl?: BiliPlayurl };
}

interface PageMeta {
  title?: string;
  thumbnail?: string;
  description?: string;
}

// ep id for OGV, aid for UGC
function parseIds(url: string): { aid?: string; epId?: string } {
  const play = /\/play\/(\d+)\/(\d+)/u.exec(url);
  if (play) return { epId: play[2] };
  const video = /\/video\/(\d+)/u.exec(url);
  if (video) return { aid: video[1] };
  return {};
}

// fps comes as a rational string
function parseFrameRate(fr?: string): number | undefined {
  if (!fr) return undefined;
  const [num, den] = fr.split('/').map((part) => Number(part));
  if (!num || Number.isNaN(num)) return undefined;
  if (!den || Number.isNaN(den)) return Math.round(num);
  const value = num / den;
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function ogTag(html: string, prop: string): string | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const forward = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
    'iu'
  );
  const backward = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
    'iu'
  );
  const match = forward.exec(html) || backward.exec(html);
  return match ? match[1] : undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&/giu, '&')
    .replace(/</giu, '<')
    .replace(/>/giu, '>')
    .replace(/"/giu, '"')
    .replace(/&#0?39;|&apos;/giu, "'")
    .replace(/&#x2F;/giu, '/');
}

// client-rendered page, only og tags
async function fetchPageMeta(url: string): Promise<PageMeta> {
  try {
    const response = await secureFetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...biliCookieHeader(),
      },
    });
    if (!response.ok) return {};
    const html = await response.text();

    const rawTitle = ogTag(html, 'og:title');
    // drop the site-name suffix
    const title = rawTitle
      ? decodeEntities(rawTitle)
          .replace(/[|\-–]\s*bilibili$/iu, '')
          .trim()
      : undefined;
    const description = ogTag(html, 'og:description');

    return {
      title: title || undefined,
      thumbnail: ogTag(html, 'og:image') || undefined,
      description: description ? decodeEntities(description).trim() : undefined,
    };
  } catch {
    return {};
  }
}

function buildAudioRawFormats(playurl: BiliPlayurl): RawFormat[] {
  return (playurl.audio_resource ?? [])
    .filter((audio) => Boolean(audio.url))
    .map((audio) => ({
      url: audio.url,
      acodec: audio.codecs || 'mp4a',
      abr: audio.bandwidth ? Math.round(audio.bandwidth / 1000) : undefined,
      filesize: typeof audio.size === 'number' ? audio.size : undefined,
      ext: 'm4a',
      formatId: `audio-${audio.quality ?? audio.bandwidth ?? 'src'}`,
      is_audio: true,
      isAudio: true,
      is_video: false,
      isVideo: false,
    }));
}

function buildVideoRawFormats(
  playurl: BiliPlayurl,
  audioUrl: string | undefined
): RawFormat[] {
  const entries = (playurl.video ?? [])
    .map((entry) => entry.video_resource)
    .filter(
      (resource): resource is BiliResource =>
        Boolean(resource?.url) &&
        (resource?.codecs ?? '').toLowerCase().startsWith('avc')
    );

  return entries.map((resource) => {
    const height = resource.height || 0;
    return {
      url: resource.url,
      height,
      width: resource.width || 0,
      fps: parseFrameRate(resource.frame_rate),
      vcodec: resource.codecs || 'avc1',
      acodec: 'none',
      filesize: typeof resource.size === 'number' ? resource.size : undefined,
      bitrate: resource.bandwidth,
      formatId: height ? `${height}p` : `q${resource.quality ?? 'src'}`,
      quality_label: height ? `${height}p` : undefined,
      ext: 'mp4',
      // has_video also marks audio; pair audio for mux
      is_video: true,
      isVideo: true,
      is_audio: false,
      isAudio: false,
      audioUrl,
    } as RawFormat;
  });
}

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const { aid, epId } = parseIds(url);
    // null falls back to yt-dlp
    if (!aid && !epId) return null;

    console.log(
      `[Metadata] Engine: Pure-JS | Platform: Bilibili | URL: ${url}`
    );

    const query = new URLSearchParams({
      platform: 'web',
      s_locale: 'en_US',
    });
    if (aid) query.set('aid', aid);
    else if (epId) query.set('ep_id', epId);

    const [playResponse, meta] = await Promise.all([
      secureFetch(`${PLAYURL_API}?${query.toString()}`, {
        headers: {
          'User-Agent': DESKTOP_UA,
          Referer: REFERER,
          Accept: 'application/json',
          ...biliCookieHeader(),
        },
      }),
      fetchPageMeta(url),
    ]);

    if (!playResponse.ok) return null;
    const payload = (await playResponse.json()) as BiliPlayurlResponse;
    const playurl = payload?.data?.playurl;
    if (!playurl) return null;

    const durationSec = playurl.duration
      ? Math.round(playurl.duration / 1000)
      : undefined;

    const audioRaw = buildAudioRawFormats(playurl);
    const audioFormats = processAudioFormats({ formats: audioRaw });
    const bestAudioUrl = audioFormats[0]?.url || audioRaw[0]?.url;

    const videoRaw = buildVideoRawFormats(playurl, bestAudioUrl);
    const formats = processVideoFormats({
      duration: durationSec,
      formats: videoRaw,
    });

    if (formats.length === 0) return null;

    const info: VideoInfo = {
      type: 'video',
      id: aid || epId || url,
      title: meta.title || 'Bilibili Video',
      uploader: 'Bilibili',
      webpageUrl: url,
      thumbnail: meta.thumbnail || undefined,
      description: meta.description || undefined,
      duration: durationSec,
      formats,
      audioFormats,
      extractorKey: 'bilibili',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: true,
    };

    info.title = normalizeTitle(info as unknown as Record<string, unknown>);
    info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[JS-Bilibili] Error extracting ${url}: ${message}`);
    return null;
  }
}

export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const opts = options as ExtractorOptions & { type?: string };
  const wantAudio =
    opts.type === 'audio' ||
    opts.format === 'mp3' ||
    opts.format === 'm4a' ||
    opts.format === 'audio';

  let selected: Format | undefined;
  if (wantAudio) {
    const audioPool = videoInfo.audioFormats ?? [];
    selected =
      audioPool.find(
        (format) => String(format.formatId) === String(opts.formatId)
      ) ||
      audioPool[0] ||
      videoInfo.formats.find((format) => format.isAudio);
  } else {
    selected =
      videoInfo.formats.find(
        (format) => String(format.formatId) === String(opts.formatId)
      ) || videoInfo.formats[0];
  }

  if (!selected?.url) throw new Error('No stream URL found');

  // cdn 403s without this referer
  return Promise.resolve(
    getProxiedStream(selected.url, {
      'User-Agent': DESKTOP_UA,
      Referer: REFERER,
    })
  );
}
