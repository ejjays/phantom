import { VideoInfo, Format } from './shared/types';
import { gatedFetch, mapLimit } from '../lib/net';
import { cookieGet } from '../lib/authFetch';
import { noVideo, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, log } from '../lib/log';
import { decodeEntities, probeFileSize } from './shared/utils';
import { buildVideoInfo } from './shared/videoInfo';
const REFERER = 'https://www.reddit.com/';
const RD_DEBUG = false;

function dbg(...parts: unknown[]): void {
  if (RD_DEBUG) log('reddit', '[JS-Reddit]', ...parts);
}

async function postId(url: string): Promise<string | null> {
  const direct = url.match(/\/comments\/([a-z0-9]+)/iu);
  if (direct) return direct[1];
  // share/short links redirect to permalink
  const res = await gatedFetch(url, {
    headers: { 'User-Agent': DESKTOP_UA },
    redirect: 'follow',
  });
  const finalUrl = res.url || res.headers?.get('location') || '';
  dbg('redirect', res.status, '->', finalUrl);
  const redir = finalUrl.match(/\/comments\/([a-z0-9]+)/iu);
  return redir ? redir[1] : null;
}

interface RedditMeta {
  vid: string;
  title: string;
  uploader: string;
  thumbnail?: string;
}

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

// june 2026: reddit login-walls every anonymous request (old.reddit, .json,
// api.reddit) on all ips — svc/shreddit seeker-session hands out cookies
// (loid + session_tracker + csrf/token_v2) that unlock anonymous .json again
// (yt-dlp #16839). replaying full jar matters: partial jars read as bot.
let sessionJar: { value: string; at: number } | null = null;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function harvestSession(id: string): Promise<string | null> {
  if (sessionJar && Date.now() - sessionJar.at < SESSION_TTL_MS) {
    return sessionJar.value;
  }
  try {
    const res = await cookieGet(
      `https://www.reddit.com/svc/shreddit/comments/${id}?seeker-session=false&render-mode=partial&referer=${encodeURIComponent(REFERER)}`,
      { 'User-Agent': DESKTOP_UA, Accept: 'text/html' }
    );
    dbg('session', res.status);
    if (!res.ok) return null;
    const jar = (res.headers?.['set-cookie'] ?? '')
      .split(/,(?=[^;,]+?=)/u)
      .map((cookie) => cookie.split(';')[0].trim())
      .filter((pair) => /^[a-z][a-z0-9_]*=/iu.test(pair));
    const merged = [...new Set(jar)].join('; ');
    if (!/loid=/iu.test(merged)) return null;
    sessionJar = { value: merged, at: Date.now() };
    return merged;
  } catch {
    return null;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function vidOf(post: RedditPostData | undefined): string | undefined {
  if (!post) return undefined;
  const fallbackUrl =
    str(post.secure_media?.reddit_video?.fallback_url) ??
    str(post.media?.reddit_video?.fallback_url);
  const found = fallbackUrl
    ? /v\.redd\.it\/([a-z0-9]+)/iu.exec(fallbackUrl)?.[1]
    : undefined;
  return (
    found ?? vidOf(post.crosspost_parent_list?.[0])
  );
}

// challenge pages arrive as 200-html or 403 — both need a fresh loid + retry.
// degraded payloads parse as json but strip media fields from video posts
// (anti-bot) — flagged via isVideo so caller can fall back to html scrape.
type MetaResult =
  | { kind: 'challenge' }
  | { kind: 'ok'; meta: RedditMeta | null; isVideo: boolean };

function metaOf(post: RedditPostData, vid: string): RedditMeta {
  const author = str(post.author);
  const previewUrl = str(post.preview?.images?.[0]?.source?.url);
  const thumb =
    (previewUrl ? decodeEntities(previewUrl) : undefined) ||
    (/^https?:\/\//iu.test(str(post.thumbnail) ?? '')
      ? str(post.thumbnail)
      : undefined);
  return {
    vid,
    title: str(post.title) ?? 'Reddit Video',
    uploader: author && author !== '[deleted]' ? author : 'Reddit',
    thumbnail: thumb,
  };
}

function parsePostJson(text: string): MetaResult {  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'challenge' };
  }
  const listing = Array.isArray(parsed) ? parsed[0] : parsed;
  const post = (
    listing as { data?: { children?: { data?: RedditPostData }[] } } | undefined
  )?.data?.children?.[0]?.data;
  if (!post) return { kind: 'ok', meta: null, isVideo: false };
  const vid = vidOf(post);
  if (!vid) return { kind: 'ok', meta: null, isVideo: post.is_video === true };
  return { kind: 'ok', meta: metaOf(post, vid), isVideo: true };
}

// degraded json strips media but the html pages keep it server-side
async function fetchMetaHtml(
  id: string,
  cookie: string | null
): Promise<RedditMeta | null> {
  for (const url of [
    `https://old.reddit.com/comments/${id}/`,
    `https://www.reddit.com/comments/${id}/`,
  ]) {
    try {
      const res = await cookieGet(url, {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html',
        ...(cookie ? { Cookie: cookie } : {}),
      });
      dbg('html', res.status, url);
      if (!res.ok) continue;
      const html = await res.text();
      const shreddit = /<shreddit-post[^>]*>/iu.exec(html)?.[0] ?? '';
      const vid =
        /data-url="https?:\/\/v\.redd\.it\/([a-z0-9]+)"/iu.exec(html)?.[1] ??
        /fallback_url\\?":\\?"https?:\\?\/\\?\/v\.redd\.it\/([a-z0-9]+)/iu.exec(html)?.[1] ??
        /v\.redd\.it\/([a-z0-9]+)/iu.exec(html)?.[1];
      if (!vid) continue;

      const title =
        /property="og:title"[^>]+content="([^"]*)"/iu.exec(html)?.[1] ??
        /\btitle="([^"]*)"/iu.exec(shreddit)?.[1];
      const author =
        /data-author="([^"]+)"/iu.exec(html)?.[1] ??
        /\bauthor="([^"]+)"/iu.exec(shreddit)?.[1];
      const image = /property="og:image"[^>]+content="([^"]*)"/iu.exec(html)?.[1];
      return {
        vid,
        title: title ? decodeEntities(title) : 'Reddit Video',
        uploader:
          author && author !== '[deleted]' && author !== '' ? author : 'Reddit',
        thumbnail: image ? decodeEntities(image) : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchMeta(id: string): Promise<RedditMeta | null> {
  let cookie = await harvestSession(id);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await cookieGet(`https://www.reddit.com/comments/${id}.json?raw_json=1`, {
      'User-Agent': DESKTOP_UA,
      Accept: 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    });
    dbg('json', res.status);
    lastStatus = res.status;
    const result = res.ok
      ? parsePostJson(await res.text())
      : ({ kind: 'challenge' } as const);
    // true image/gallery post — no point retrying or scraping html
    if (result.kind === 'ok' && (!result.isVideo || result.meta)) {
      return result.meta;
    }

    // stale session, bot-challenge or degraded payload -> fresh jar, retry
    sessionJar = null;
    cookie = await harvestSession(id);
    if (attempt < 2) await sleep(1500 * (attempt + 1));
  }
  const scraped = await fetchMetaHtml(id, cookie);
  if (scraped) return scraped;
  throw fromStatus(lastStatus || 503, 'Reddit');
}
function attrNum(attrs: string, name: string): number {
  const found = attrs.match(new RegExp(`\\b${name}="(\\d+)"`, 'u'));
  return found ? Number(found[1]) : 0;
}

/** audio reps wedge AudioChannelConfiguration before BaseURL,
 *  so scan whole block, not "tag then BaseURL". */
function repBlocks(mpd: string): { attrs: string; name: string }[] {
  return mpd
    .split(/<Representation\b/iu)
    .slice(1)
    .map((part) => {
      const close = part.indexOf('>');
      const base = part.match(/<BaseURL>([^<]+)<\/BaseURL>/iu);
      return {
        attrs: close >= 0 ? part.slice(0, close) : '',
        name: base?.[1].trim() ?? '',
      };
    })
    .filter((rep) => rep.name);
}

function parseDuration(mpd: string): number | undefined {
  const found = mpd.match(
    /mediaPresentationDuration="PT(?:(\d+)M)?([\d.]+)S"/u
  );
  return found
    ? Math.round(Number(found[1] || 0) * 60 + Number(found[2]))
    : undefined;
}

function pickAudioUrl(
  reps: { attrs: string; name: string }[],
  base: string
): string | undefined {
  const audio = reps
    .filter((rep) => /audio/iu.test(rep.name))
    .sort(
      (lhs, rhs) =>
        attrNum(rhs.attrs, 'bandwidth') - attrNum(lhs.attrs, 'bandwidth')
    )[0];
  return audio ? `${base}/${audio.name}` : undefined;
}

// split a/v, muxed on-device
function buildFormats(
  reps: { attrs: string; name: string }[],
  base: string,
  audioUrl: string | undefined
): Format[] {
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
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const id = await postId(url);
    dbg('id', id);
    if (!id) return null;

    const meta = await fetchMeta(id);
    dbg('vid', meta?.vid);
    if (!meta) throw noVideo('Reddit');

    const base = `https://v.redd.it/${meta.vid}`;
    const mpdRes = await gatedFetch(`${base}/DASHPlaylist.mpd`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    dbg('mpd', mpdRes.status, mpdRes.ok);
    if (!mpdRes.ok) throw fromStatus(mpdRes.status, 'Reddit');
    const mpd = await mpdRes.text();

    const reps = repBlocks(mpd);
    const audioUrl = pickAudioUrl(reps, base);
    const formats = buildFormats(reps, base, audioUrl);
    if (formats.length === 0) throw noVideo('Reddit');

    // mpd has no size; HEAD each quality
    const audioSize = audioUrl
      ? ((await probeFileSize(audioUrl, { 'User-Agent': DESKTOP_UA })) ?? 0)
      : 0;
    await mapLimit(formats, 3, async (format) => {
      const videoSize = await probeFileSize(format.url, {
        'User-Agent': DESKTOP_UA,
      });
      if (videoSize) format.filesize = videoSize + audioSize;
    });
    dbg('formats', formats.length, 'audio', !!audioUrl);

    return buildVideoInfo({
      id,
      title: meta.title,
      uploader: meta.uploader,
      webpageUrl: url,
      thumbnail: meta.thumbnail,
      duration: parseDuration(mpd),
      formats,
      extractorKey: 'reddit',
      downloadHeaders: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('reddit', `[JS-Reddit] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Reddit');
  }
}
