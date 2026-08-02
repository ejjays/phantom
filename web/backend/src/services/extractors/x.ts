import { secureFetch } from '../../utils/network/security.util.js';
import { logger } from '../../utils/infra/logger.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../types/index.js';
import { Readable } from 'node:stream';
import { normalizeTitle, normalizeArtist } from '../social.service.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface XVariant {
  content_type?: string;
  bitrate?: number;
  url?: string;
}
interface XMedia {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: XVariant[] };
}
interface XTweet {
  text?: string;
  full_text?: string;
  user?: { name?: string; screen_name?: string };
  mediaDetails?: XMedia[];
}

// react-tweet token derivation
function tweetToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/gu, '');
}

function buildFormats(media: XMedia): Format[] {
  const mapped = (media.video_info?.variants ?? [])
    .filter((variant) => variant.content_type === 'video/mp4' && variant.url)
    .map((variant): Format => {
      const dim = (variant.url ?? '').match(/\/(\d+)x(\d+)\//u);
      const width = dim ? Number(dim[1]) : undefined;
      const height = dim ? Number(dim[2]) : undefined;
      const short = width && height ? Math.min(width, height) : undefined;
      return {
        formatId: short ? `${short}p` : `mp4_${variant.bitrate ?? 0}`,
        url: variant.url as string,
        extension: 'mp4',
        width,
        height,
        resolution: width && height ? `${width}x${height}` : undefined,
        quality: short ? `${short}p` : undefined,
        vcodec: 'h264',
        acodec: 'aac',
        tbr: variant.bitrate ? Math.round(variant.bitrate / 1000) : undefined,
        isMuxed: true,
        isVideo: true,
        isAudio: false,
      };
    });

  mapped.sort((lhs, rhs) => (rhs.tbr ?? 0) - (lhs.tbr ?? 0));
  const seen = new Set<string>();
  const deduped = mapped.filter((format) => {
    const key = format.quality ?? format.formatId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return deduped;
}

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const idMatch = url.match(/status\/(\d+)/u);
    if (!idMatch) return null;
    const id = idMatch[1];
    const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tweetToken(id)}&lang=en`;

    const response = await secureFetch(api, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
    });
    if (!response.ok) return null; // gated/protected -> yt-dlp fallback

    const tweet = (await response.json()) as XTweet;
    const media = (tweet.mediaDetails ?? []).find(
      (item) => item.type === 'video' || item.type === 'animated_gif'
    );
    if (!media) return null;

    const formats = buildFormats(media);
    if (formats.length === 0) return null;

    // fetch sizes (twimg omits filesize)
    await Promise.all(
      formats.map(async (format) => {
        try {
          const head = await secureFetch(format.url, {
            method: 'HEAD',
            headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://x.com/' },
          });
          const len = head.headers.get('content-length');
          if (len) format.filesize = parseInt(len, 10);
        } catch {
          /* size optional */
        }
      })
    );

    // drop trailing media t.co link
    const caption = (tweet.text || tweet.full_text || 'X Video')
      .replace(/https:\/\/t\.co\/\S{1,500}$/u, '')
      .trim();

    const info: VideoInfo = {
      type: 'video',
      id,
      title: caption || 'X Video',
      uploader: tweet.user?.name || tweet.user?.screen_name || 'X User',
      webpageUrl: url,
      thumbnail: media.media_url_https || undefined,
      formats,
      extractorKey: 'x',
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
    logger.error(`[JS-X] Error extracting ${url}: ${message}`);
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

  return Promise.resolve(
    getProxiedStream(selected.url, {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://x.com/',
    })
  );
}
