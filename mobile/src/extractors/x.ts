import { VideoInfo, Format } from './shared/types';
import { normalizeTitle, normalizeArtist, probeFileSize } from './shared/utils';
import { gatedFetch, mapLimit } from '../lib/net';
import { noVideo, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError } from '../lib/log';
import { buildVideoInfo } from './shared/videoInfo';

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
  quoted_tweet?: XTweet;
}

// react-tweet token derivation
export function tweetToken(id: string): string {
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
        isAudio: true,
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

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const idMatch = url.match(/status\/(\d+)/u);
    if (!idMatch) return null;
    const id = idMatch[1];
    const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tweetToken(id)}&lang=en`;

    const response = await gatedFetch(api, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
    });
    // deleted (404) or protected (403)
    if (!response.ok) throw fromStatus(response.status, 'X');

    const tweet = (await response.json()) as XTweet;
    const media =
      (tweet.mediaDetails ?? []).find(
        (item) => item.type === 'video' || item.type === 'animated_gif'
      ) ??
      (tweet.quoted_tweet?.mediaDetails ?? []).find(
        (item) => item.type === 'video' || item.type === 'animated_gif'
      );
    if (!media) throw noVideo('X');

    const formats = buildFormats(media);
    if (formats.length === 0) throw noVideo('X');

    // twimg omits filesize
    await mapLimit(formats, 2, async (format) => {
      if (format.filesize) return;
      const size = await probeFileSize(format.url, {
        'User-Agent': DESKTOP_UA,
        Referer: 'https://x.com/',
      });
      if (size) format.filesize = size;
    });

    // drop trailing media t.co link
    const caption = (tweet.text || tweet.full_text || 'X Video')
      .replace(/\s*https:\/\/t\.co\/\S+\s*$/u, '')
      .trim();

    const info: VideoInfo = buildVideoInfo({
      id,
      title: caption || 'X Video',
      uploader: tweet.user?.name || tweet.user?.screen_name || 'X User',
      webpageUrl: url,
      thumbnail: media.media_url_https || undefined,
      formats,
      extractorKey: 'x',
    });

    info.title = normalizeTitle(info as unknown as Record<string, unknown>);
    info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('x', `[JS-X] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'X');
  }
}
