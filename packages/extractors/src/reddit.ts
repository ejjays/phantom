import { Format, VideoInfo, ExtractorOptions } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { normalizeTitle, normalizeArtist } from './social.js';
import { DESKTOP_UA, decodeEntities } from './util.js';
import { noVideo, fromStatus, classifyThrown, ExtractorError } from './errors.js';

const REFERER = 'https://www.reddit.com/';

interface RedditPostData {
  title?: unknown;
  author?: unknown;
  thumbnail?: unknown;
  is_video?: unknown;
  media?: { reddit_video?: { fallback_url?: unknown } } | null;
  secure_media?: { reddit_video?: { fallback_url?: unknown } } | null;
  preview?: { images?: { source?: { url?: unknown } }[] } | null;
  crosspost_parent_list?: RedditPostData[];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function vidOf(post: RedditPostData | undefined): string | undefined {
  if (!post) return undefined;
  const fallbackUrl = str(post.secure_media?.reddit_video?.fallback_url) ?? str(post.media?.reddit_video?.fallback_url);
  const found = fallbackUrl ? /v\.redd\.it\/([a-z0-9]+)/iu.exec(fallbackUrl)?.[1] : undefined;
  return found ?? vidOf(post.crosspost_parent_list?.[0]);
}

async function postId(env: ExtractorEnv, url: string): Promise<string | null> {
  const direct = url.match(/\/comments\/([a-z0-9]+)/iu);
  if (direct) return direct[1];
  try {
    const res = await env.fetch(url, { headers: { 'User-Agent': DESKTOP_UA }, redirect: 'follow' } as RequestInit);
    const finalUrl = (res as unknown as { url: string }).url ?? '';
    const redir = finalUrl.match(/\/comments\/([a-z0-9]+)/iu);
    return redir ? redir[1] : null;
  } catch {
    return null;
  }
}

function parsePostJson(text: string): { vid?: string; title?: string; uploader?: string; thumbnail?: string; isVideo: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const listing = Array.isArray(parsed) ? parsed[0] : parsed;
  const post = (listing as { data?: { children?: { data?: RedditPostData }[] } })?.data?.children?.[0]?.data;
  if (!post) return null;
  const vid = vidOf(post);
  if (vid) {
    const author = str(post.author);
    const previewUrl = str(post.preview?.images?.[0]?.source?.url);
    const thumb = (previewUrl ? decodeEntities(previewUrl) : undefined) ?? (/^https?:\/\//iu.test(str(post.thumbnail) ?? '') ? str(post.thumbnail) : undefined);
    return { vid, title: str(post.title) ?? 'Reddit Video', uploader: author && author !== '[deleted]' ? author : 'Reddit', thumbnail: thumb, isVideo: true };
  }
  return { isVideo: post.is_video === true };
}

async function fetchMeta(env: ExtractorEnv, id: string): Promise<{ vid: string; title: string; uploader: string; thumbnail?: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await env.fetch(`https://www.reddit.com/comments/${id}.json?raw_json=1`, {
        headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parsePostJson(text);
      if (parsed?.vid) return parsed as { vid: string; title: string; uploader: string; thumbnail?: string };
      if (parsed && !parsed.isVideo) return null;
    } catch {
      /* retry */
    }
  }
  for (const url of [`https://old.reddit.com/comments/${id}/`, `https://www.reddit.com/comments/${id}/`]) {
    try {
      const res = await env.fetch(url, { headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html' } });
      if (!res.ok) continue;
      const html = await res.text();
      const vid = /data-url="https?:\/\/v\.redd\.it\/([a-z0-9]+)"/iu.exec(html)?.[1] ?? /fallback_url\\?":\\?"https?:\\?\/\\?\/v\.redd\.it\/([a-z0-9]+)/iu.exec(html)?.[1];
      if (!vid) continue;
      const title = /property="og:title"[^>]+content="([^"]*)"/iu.exec(html)?.[1] ?? 'Reddit Video';
      const author = /data-author="([^"]+)"/iu.exec(html)?.[1] ?? 'Reddit';
      const image = /property="og:image"[^>]+content="([^"]*)"/iu.exec(html)?.[1];
      return { vid, title: decodeEntities(title), uploader: author !== '[deleted]' && author ? author : 'Reddit', thumbnail: image ? decodeEntities(image) : undefined };
    } catch {
      continue;
    }
  }
  return null;
}

function attrNum(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`\\b${name}="(\\d+)"`, 'u'));
  return m ? Number(m[1]) : 0;
}

function repBlocks(mpd: string): { attrs: string; name: string }[] {
  return mpd
    .split(/<Representation\b/iu)
    .slice(1)
    .map((part) => {
      const close = part.indexOf('>');
      const base = part.match(/<BaseURL>([^<]+)<\/BaseURL>/iu);
      return { attrs: close >= 0 ? part.slice(0, close) : '', name: base?.[1].trim() ?? '' };
    })
    .filter((r) => r.name);
}

function parseDuration(mpd: string): number | undefined {
  const m = mpd.match(/mediaPresentationDuration="PT(?:(\d+)M)?([\d.]+)S"/u);
  return m ? Math.round(Number(m[1] ?? 0) * 60 + Number(m[2])) : undefined;
}

function pickAudioUrl(reps: { attrs: string; name: string }[], base: string): string | undefined {
  const audio = reps.filter((r) => /audio/iu.test(r.name)).sort((a, b) => attrNum(b.attrs, 'bandwidth') - attrNum(a.attrs, 'bandwidth'))[0];
  return audio ? `${base}/${audio.name}` : undefined;
}
function buildFormats(reps: { attrs: string; name: string }[], base: string, audioUrl?: string): Format[] {
  const seen = new Set<number>();
  const formats: Format[] = [];
  for (const rep of reps) {
    if (/audio/iu.test(rep.name)) continue;
    const width = attrNum(rep.attrs, 'width');
    const height = attrNum(rep.attrs, 'height');
    const short = width && height ? Math.min(width, height) : 0;
    if (seen.has(short)) continue;
    seen.add(short);
    const bw = attrNum(rep.attrs, 'bandwidth');
    formats.push({
      formatId: short ? `${short}p` : rep.name,
      url: `${base}/${rep.name}`,
      extension: 'mp4',
      resolution: width && height ? `${width}x${height}` : undefined,
      quality: short ? `${short}p` : undefined,
      width: width || undefined,
      height: height || undefined,
      tbr: bw ? Math.round(bw / 1000) : undefined,
      vcodec: 'h264',
      acodec: audioUrl ? 'aac' : 'none',
      isVideo: true,
      isAudio: false,
      isMuxed: !audioUrl,
      muxAudioUrl: audioUrl,
      muxAudioExt: 'm4a',
    });
  }
  formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return formats;
}

export function createRedditExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, _opts: ExtractorOptions = {}): Promise<VideoInfo | null> {
    const id = await postId(env, url);
    if (!id) return null;
    try {
      const meta = await fetchMeta(env, id);
      if (!meta) throw noVideo('Reddit');
      const base = `https://v.redd.it/${meta.vid}`;
      const mpdRes = await env.fetch(`${base}/DASHPlaylist.mpd`, { headers: { 'User-Agent': DESKTOP_UA } });
      if (!mpdRes.ok) throw fromStatus(mpdRes.status, 'Reddit');
      const mpd = await mpdRes.text();
      const reps = repBlocks(mpd);
      const audioUrl = pickAudioUrl(reps, base);
      const formats = buildFormats(reps, base, audioUrl);
      if (formats.length === 0) throw noVideo('Reddit', 'clip');
      const info: VideoInfo = {
        type: 'video',
        id,
        title: meta.title,
        uploader: meta.uploader,
        webpageUrl: url,
        thumbnail: meta.thumbnail,
        duration: parseDuration(mpd),
        formats,
        extractorKey: 'reddit',
        isJsInfo: true,
        fromBrain: false,
        isPartial: false,
        isIsrcMatch: false,
        isFullData: true,
        downloadHeaders: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
      };
      info.title = normalizeTitle(info as unknown as Record<string, unknown>);
      info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);
      return info;
    } catch (error: unknown) {
      if (error instanceof ExtractorError) throw error;
      throw classifyThrown(error, 'Reddit');
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const selected =
      videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!selected?.url) throw new Error('No stream URL');
    if (selected.url.includes('.m3u8') || selected.isHls) {
      if (!env.remuxHls) throw new Error('HLS needs remuxHls');
      return env.remuxHls(selected.url, {});
    }
    return env.streamUrl(selected.url, {});
  }

  return { getInfo, getStream };
}
