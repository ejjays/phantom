import { VideoInfo, Format } from './shared/types';
import { getBilibiliCookie } from '../lib/settings';
import { gatedFetch } from '../lib/net';
import { noVideo, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError } from '../lib/log';
import { decodeEntities } from './shared/utils';
import { buildVideoInfo } from './shared/videoInfo';

// international bilibili.tv (bstar), not mainland .com
const PLAYURL_API = 'https://api.bilibili.tv/intl/gateway/web/playurl';
const REFERER = 'https://www.bilibili.tv/';

interface BiliResource {
  quality?: number;
  bandwidth?: number;
  codecs?: string;
  size?: number;
  url?: string;
  width?: number;
  height?: number;
}
interface BiliVideoEntry {
  video_resource?: BiliResource;
}
interface BiliPlayurl {
  duration?: number;
  video?: BiliVideoEntry[];
  audio_resource?: BiliResource[];
}
interface BiliResponse {
  data?: { playurl?: BiliPlayurl };
}

// ep id for OGV, aid for UGC
function parseIds(url: string): { aid?: string; epId?: string } {
  const play = /\/play\/(\d+)\/(\d+)/u.exec(url);
  if (play) return { epId: play[2] };
  const video = /\/video\/(\d+)/u.exec(url);
  if (video) return { aid: video[1] };
  return {};
}

function ogTag(html: string, prop: string): string | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
    'iu'
  );
  const match = re.exec(html);
  return match ? match[1] : undefined;
}

// prefer clean ld+json cover
function pickThumbnail(html: string): string | undefined {
  const ld = /"thumbnailUrl"\s*:\s*"([^"]+)"/u.exec(html);
  if (ld?.[1]) return ld[1];
  const og = ogTag(html, 'og:image');
  return og ? og.split('?')[0] : undefined;
}

async function fetchPageMeta(
  url: string,
  cookie: Record<string, string>
): Promise<{ title?: string; thumbnail?: string }> {
  try {
    const response = await gatedFetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...cookie,
      },
    });
    if (!response.ok) return {};
    const html = await response.text();
    const rawTitle = ogTag(html, 'og:title');
    const title = rawTitle
      ? decodeEntities(rawTitle)
          .replace(/\s*[|\-–]\s*bili\s*bili\s*$/iu, '')
          .trim()
      : undefined;
    return {
      title: title || undefined,
      thumbnail: pickThumbnail(html),
    };
  } catch {
    return {};
  }
}

function videoFormat(
  res: BiliResource,
  audioUrl: string | undefined,
  audioSize: number
): Format {
  const height = res.height || 0;
  const videoSize = typeof res.size === 'number' ? res.size : 0;
  const total = videoSize + audioSize;
  return {
    formatId: height ? `${height}p` : `q${res.quality ?? 'src'}`,
    url: res.url ?? '',
    extension: 'mp4',
    resolution: height ? `${height}p` : undefined,
    quality: height ? `${height}p` : undefined,
    width: res.width || undefined,
    height: height || undefined,
    tbr: res.bandwidth ? Math.round(res.bandwidth / 1000) : undefined,
    vcodec: 'h264',
    acodec: audioUrl ? 'aac' : 'none',
    isVideo: true,
    isAudio: false,
    isMuxed: false,
    filesize: total > 0 ? total : undefined,
    muxAudioUrl: audioUrl,
    muxAudioExt: 'm4a',
  };
}

function audioFormat(audio: BiliResource): Format {
  return {
    formatId: `audio-${audio.quality ?? 'src'}`,
    url: audio.url ?? '',
    extension: 'm4a',
    quality: 'Audio',
    tbr: audio.bandwidth ? Math.round(audio.bandwidth / 1000) : undefined,
    vcodec: 'none',
    acodec: 'aac',
    isVideo: false,
    isAudio: true,
    isMuxed: false,
    filesize: typeof audio.size === 'number' ? audio.size : undefined,
  };
}

function buildFormats(playurl: BiliPlayurl): Format[] {
  const audios = (playurl.audio_resource ?? []).filter((a) => a.url);
  const bestAudio = [...audios].sort(
    (lhs, rhs) => (rhs.bandwidth ?? 0) - (lhs.bandwidth ?? 0)
  )[0];
  const audioSize =
    bestAudio && typeof bestAudio.size === 'number' ? bestAudio.size : 0;

  /* avc only, one per height */
  const seen = new Set<number>();
  const videoFormats: Format[] = [];
  for (const entry of playurl.video ?? []) {
    const res = entry.video_resource;
    if (!res?.url) continue;
    if (!(res.codecs ?? '').toLowerCase().startsWith('avc')) continue;
    const height = res.height || 0;
    if (seen.has(height)) continue;
    seen.add(height);
    videoFormats.push(videoFormat(res, bestAudio?.url, audioSize));
  }
  videoFormats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));

  const audioFormats = bestAudio?.url ? [audioFormat(bestAudio)] : [];
  return [...videoFormats, ...audioFormats];
}

async function resolveTarget(
  url: string
): Promise<{ target: string; aid?: string; epId?: string }> {
  const direct = parseIds(url);
  if (direct.aid || direct.epId) return { target: url, ...direct };
  const res = await gatedFetch(url, {
    headers: { 'User-Agent': DESKTOP_UA },
    redirect: 'follow',
  });
  const target = res.url || url;
  return { target, ...parseIds(target) };
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const { target, aid, epId } = await resolveTarget(url);
    if (!aid && !epId) return null;

    const cookieValue = await getBilibiliCookie();
    // cookie unlocks login-gated HD
    const cookie: Record<string, string> = cookieValue
      ? { Cookie: cookieValue }
      : {};

    const query = new URLSearchParams({ platform: 'web', s_locale: 'en_US' });
    if (aid) query.set('aid', aid);
    else if (epId) query.set('ep_id', epId);

    const [playRes, meta] = await Promise.all([
      gatedFetch(`${PLAYURL_API}?${query.toString()}`, {
        headers: {
          'User-Agent': DESKTOP_UA,
          Referer: REFERER,
          Accept: 'application/json',
          ...cookie,
        },
      }),
      fetchPageMeta(target, cookie),
    ]);

    if (!playRes.ok) throw fromStatus(playRes.status, 'Bilibili');
    const payload = (await playRes.json()) as BiliResponse;
    const playurl = payload?.data?.playurl;
    if (!playurl) throw noVideo('Bilibili');

    const formats = buildFormats(playurl);
    if (formats.length === 0) throw noVideo('Bilibili');

    const durationSec = playurl.duration
      ? Math.round(playurl.duration / 1000)
      : undefined;

    return buildVideoInfo({
      id: aid || epId || target,
      title: meta.title || 'Bilibili Video',
      uploader: 'Bilibili',
      webpageUrl: target,
      thumbnail: meta.thumbnail,
      duration: durationSec,
      formats,
      extractorKey: 'bilibili',
      downloadHeaders: {
        'User-Agent': DESKTOP_UA,
        Referer: REFERER,
        Range: 'bytes=0-',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('bilibili', `[JS-Bilibili] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Bilibili');
  }
}
