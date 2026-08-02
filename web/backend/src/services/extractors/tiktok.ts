import { secureFetch } from '../../utils/network/security.util.js';
import { logger } from '../../utils/infra/logger.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../types/index.js';
import { Readable } from 'node:stream';
import { normalizeTitle, normalizeArtist } from '../social.service.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cookieCache = new Map<string, string>();

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
function parseUniversalData(html: string): TikTokItem | null {
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
        isAudio: false,
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
      isAudio: false,
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

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const response = await secureFetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) return null;

    const cookieHeader = (response.headers.getSetCookie?.() ?? [])
      .map((entry) => entry.split(';')[0])
      .join('; ');

    // null lets pipeline fall back to yt-dlp
    const item = parseUniversalData(await response.text());
    if (!item) return null;

    const isPhoto = Boolean(item.imagePost?.images?.length);
    const formats = isPhoto
      ? buildPhotoFormats(item)
      : item.video
        ? buildVideoFormats(item.video)
        : [];
    if (formats.length === 0) return null;

    const info: VideoInfo = {
      type: 'video',
      id: item.id || url,
      title: item.desc || 'TikTok Video',
      uploader: item.author?.nickname || item.author?.uniqueId || 'TikTok User',
      webpageUrl: response.url,
      thumbnail: item.video?.cover || item.video?.originCover || undefined,
      duration: item.video?.duration,
      formats,
      extractorKey: 'tiktok',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: !isPhoto,
    };

    info.title = normalizeTitle(info as unknown as Record<string, unknown>);
    info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

    if (cookieHeader) {
      if (cookieCache.size >= 100) {
        const oldest = cookieCache.keys().next().value;
        if (oldest !== undefined) cookieCache.delete(oldest);
      }
      cookieCache.set(info.id, cookieHeader);
    }

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[JS-TikTok] Error extracting ${url}: ${message}`);
    return null;
  }
}

export async function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const selected =
    videoInfo.formats.find(
      (format) => String(format.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!selected?.url) throw new Error('No stream URL found');

  // cookies + referer + range authorize cdn
  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://www.tiktok.com/',
    Range: 'bytes=0-',
  };
  const cookie = cookieCache.get(videoInfo.id);
  if (cookie) headers.Cookie = cookie;

  const response = await secureFetch(selected.url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`TikTok stream failed: HTTP ${response.status}`);
  }
  return Readable.fromWeb(
    response.body as import('node:stream/web').ReadableStream
  );
}
