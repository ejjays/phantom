import { VideoInfo, Format } from './types';
import { normalizeTitle, normalizeArtist } from './social';
import { gatedFetch } from '../lib/net';
import { noVideo, fromStatus, temporaryError, classifyThrown } from './errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, log, warn as logWarn } from '../lib/log';
import { buildVideoInfo } from './videoInfo';

interface TikTokPlayAddr {
  Width?: number;
  Height?: number;
  DataSize?: number;
  UrlList?: string[];
}
interface TikTokBitrate {
  Bitrate?: number;
  GearName?: string;
  CodecType?: string;
  PlayAddr?: TikTokPlayAddr;
}
interface TikTokVideo {
  duration?: number;
  width?: number;
  height?: number;
  cover?: string;
  originCover?: string;
  playAddr?: string;
  codecType?: string;
  bitrateInfo?: TikTokBitrate[];
}
interface TikTokItem {
  id?: string;
  desc?: string;
  author?: { uniqueId?: string; nickname?: string };
  video?: TikTokVideo;
  imagePost?: { images?: { imageURL?: { urlList?: string[] } }[] };
}

// extract embedded rehydration JSON
export function parseUniversalData(html: string): TikTokItem | null {
  const match = html.match(
    /<script\b[^>]*\bid="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/u
  );
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]) as {
      __DEFAULT_SCOPE__?: {
        'webapp.video-detail'?: { itemInfo?: { itemStruct?: TikTokItem } };
      };
    };
    return (
      data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ??
      null
    );
  } catch {
    return null;
  }
}

function buildVideoFormats(video: TikTokVideo): Format[] {
  const mapped = (video.bitrateInfo ?? [])
    .map((rung): Format | null => {
      const url = rung.PlayAddr?.UrlList?.[0];
      if (!url) return null;
      const width = rung.PlayAddr?.Width ?? video.width;
      const height = rung.PlayAddr?.Height ?? video.height;
      const short = width && height ? Math.min(width, height) : undefined;
      const isHevc = rung.CodecType?.includes('265') ?? false;
      return {
        formatId: rung.GearName || `${short ?? 'src'}p`,
        url,
        extension: 'mp4',
        width,
        height,
        resolution: width && height ? `${width}x${height}` : undefined,
        quality: short ? `${short}p${isHevc ? ' (HEVC)' : ''}` : undefined,
        vcodec: isHevc ? 'hevc' : 'h264',
        acodec: 'aac',
        tbr: rung.Bitrate ? Math.round(rung.Bitrate / 1000) : undefined,
        filesize:
          typeof rung.PlayAddr?.DataSize === 'number'
            ? rung.PlayAddr.DataSize
            : undefined,
        isMuxed: true,
        isVideo: true,
        isAudio: true,
      };
    })
    .filter((format): format is Format => format !== null);

  // dedup by resolution; prefer h264
  mapped.sort((lhs, rhs) => {
    const byHeight = (rhs.height ?? 0) - (lhs.height ?? 0);
    if (byHeight !== 0) return byHeight;
    if (lhs.vcodec !== rhs.vcodec) return lhs.vcodec === 'h264' ? -1 : 1;
    return (rhs.tbr ?? 0) - (lhs.tbr ?? 0);
  });
  const seen = new Set<number>();
  const deduped = mapped.filter((format) => {
    const key = format.height ?? 0;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // fallback to single muxed url
  if (deduped.length === 0 && video.playAddr) {
    deduped.push({
      formatId: 'source',
      url: video.playAddr,
      extension: 'mp4',
      width: video.width,
      height: video.height,
      resolution:
        video.width && video.height
          ? `${video.width}x${video.height}`
          : undefined,
      vcodec: video.codecType?.includes('265') ? 'hevc' : 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: true,
    });
  }
  return deduped;
}

function buildPhotoFormats(item: TikTokItem): Format[] {
  return (item.imagePost?.images ?? [])
    .map((image, index): Format | null => {
      const url = image.imageURL?.urlList?.[0];
      if (!url) return null;
      return {
        formatId: `image_${index}`,
        url,
        extension: 'jpeg',
        isMuxed: false,
        isVideo: false,
        isAudio: false,
      };
    })
    .filter((format): format is Format => format !== null);
}

const PAGE_HEADERS = {
  'User-Agent': DESKTOP_UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
};

const cookieJar = new Map<string, string>();

// cookies the cdn wants on download
function captureCookies(setCookie: string | null): void {
  if (!setCookie) return;
  for (const name of ['ttwid', 'tt_csrf_token', 'tt_chain_token', 'msToken']) {
    const match = setCookie.match(new RegExp(`${name}=([^;,\\s]+)`, 'u'));
    if (match) cookieJar.set(name, match[1]);
  }
}

function cookieHeader(): string {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

let cookiesPrimed = false;

// prime ttwid for the real page
async function primeCookies(): Promise<void> {
  if (cookiesPrimed) return;
  try {
    const res = await gatedFetch('https://www.tiktok.com/', {
      headers: PAGE_HEADERS,
      redirect: 'follow',
    });
    captureCookies(res.headers.get('set-cookie'));
    cookiesPrimed = true;
  } catch {
    /* best effort, continue without */
  }
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    await primeCookies();
    const response = await gatedFetch(url, {
      headers: PAGE_HEADERS,
      redirect: 'follow',
    });
    if (!response.ok) {
      logWarn('tiktok', `[JS-TikTok] HTTP ${response.status} for ${url}`);
      throw fromStatus(response.status, 'TikTok');
    }
    captureCookies(response.headers.get('set-cookie'));

    const html = await response.text();
    const item = parseUniversalData(html);
    if (!item) {
      const walled =
        /tiktok\.com\/login|captcha|verify|robot check|please wait/iu.test(
          html
        );
      logWarn(
        'tiktok',
        `[JS-TikTok] no rehydration JSON (${walled ? 'BOT/LOGIN WALL' : 'no data marker'}, ${html.length} bytes): ${url}`
      );
      throw walled ? temporaryError('TikTok') : noVideo('TikTok');
    }

    const isPhoto = Boolean(item.imagePost?.images?.length);
    const formats = isPhoto
      ? buildPhotoFormats(item)
      : item.video
        ? buildVideoFormats(item.video)
        : [];
    if (formats.length === 0) {
      logWarn('tiktok', `[JS-TikTok] parsed item but found no formats: ${url}`);
      throw noVideo('TikTok');
    }

    const info: VideoInfo = buildVideoInfo({
      id: item.id || url,
      title: item.desc || 'TikTok Video',
      uploader: item.author?.nickname || item.author?.uniqueId || 'TikTok User',
      webpageUrl: response.url || url,
      thumbnail: item.video?.cover || item.video?.originCover || undefined,
      duration: item.video?.duration,
      formats,
      extractorKey: 'tiktok',
    });
    info.isFullData = !isPhoto;

    info.title = normalizeTitle(info as unknown as Record<string, unknown>);
    info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

    const cookie = cookieHeader();
    log(
      'tiktok',
      `[JS-TikTok] download cookies: ${cookie ? 'captured' : 'none'}`
    );
    // cdn signs play urls against the session UA + referer; 403 without them
    info.downloadHeaders = {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.tiktok.com/',
      Range: 'bytes=0-',
      ...(cookie ? { Cookie: cookie } : {}),
    };

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('tiktok', `[JS-TikTok] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'TikTok');
  }
}
