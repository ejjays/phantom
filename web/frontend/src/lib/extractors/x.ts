// X/Twitter extractor: client-side port of @phantom/extractors/x
// uses proxyFetch + CORS proxy for syndication API + twimg media
import type { VideoInfo, Format } from '@shared/schemas/media.schema.js';
import { proxyFetch } from '../net';
import { normalizeArtist } from './social';

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

function tweetToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/gu, '');
}

function buildFormats(media: XMedia): Format[] {
  const mapped = (media.video_info?.variants ?? [])
    .filter((v) => v.content_type === 'video/mp4' && v.url)
    .map((v): Format => {
      const dim = (v.url ?? '').match(/\/(\d+)x(\d+)\//u);
      const width = dim ? Number(dim[1]) : undefined;
      const height = dim ? Number(dim[2]) : undefined;
      const short = width && height ? Math.min(width, height) : undefined;
      return {
        formatId: short ? `${short}p` : `mp4_${v.bitrate ?? 0}`,
        url: v.url as string,
        extension: 'mp4',
        width,
        height,
        resolution: width && height ? `${width}x${height}` : undefined,
        quality: short ? `${short}p` : undefined,
        vcodec: 'h264',
        acodec: 'aac',
        tbr: v.bitrate ? Math.round(v.bitrate / 1000) : undefined,
        isMuxed: true,
        isVideo: true,
        isAudio: false,
      };
    });
  mapped.sort((lhs, rhs) => (rhs.tbr ?? 0) - (lhs.tbr ?? 0));
  const seen = new Set<string>();
  const deduped = mapped.filter((f) => {
    const key = f.quality ?? f.formatId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return deduped;
}

export async function extractX(
  url: string,
  onPartial?: (info: Partial<VideoInfo>) => void
): Promise<VideoInfo | null> {
  try {
    const idMatch = url.match(/status\/(\d+)/u);
    if (!idMatch) return null;
    const id = idMatch[1];
    const api = `https://cdn.syndication.twitter.com/tweet-result?id=${id}&token=${tweetToken(id)}&lang=en`;

    const response = await proxyFetch(api, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const tweet = (await response.json()) as XTweet;
    const media = (tweet.mediaDetails ?? []).find(
      (item) => item.type === 'video' || item.type === 'animated_gif'
    );
    if (!media) return null;

    const formats = buildFormats(media);
    if (formats.length === 0) return null;

    onPartial?.({
      id,
      type: 'video',
      title: tweet.full_text || tweet.text || '',
      artist: tweet.user?.name,
      webpageUrl: url,
      thumbnail: media.media_url_https,
      duration: undefined,
    });

    return {
      id,
      type: 'video',
      title: tweet.full_text || tweet.text || '',
      artist: normalizeArtist({
        uploader: tweet.user?.screen_name || '',
        artist: tweet.user?.name,
        title: tweet.full_text || tweet.text,
      }),
      uploader: tweet.user?.screen_name || '',
      webpageUrl: url,
      thumbnail: media.media_url_https,
      duration: undefined,
      formats,
      audioFormats: [],
      extractorKey: 'x',
      isJsInfo: true,
      isIsrcMatch: false,
      isPartial: false,
      isFullData: true,
      fromBrain: false,
    };
  } catch {
    return null;
  }
}
