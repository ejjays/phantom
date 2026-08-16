import { VideoInfo, Format } from './types';
import { gatedFetch, mapLimit } from '../lib/net';
import { noVideo, fromStatus, classifyThrown } from './errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, log } from '../lib/log';
import { decodeEntities, probeFileSize } from './social';
import { buildVideoInfo } from './videoInfo';
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

function metaTag(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`,
    'iu'
  );
  const found = re.exec(html);
  return found ? decodeEntities(found[1]) : undefined;
}

interface RedditMeta {
  vid: string;
  title: string;
  uploader: string;
  thumbnail?: string;
}

/**
 * .json api bot-walled now — 403s every ip, even residential.
 * old.reddit still serves real server-rendered html, so scrape
 * v.redd.it id + title from there.
 */
async function fetchMeta(id: string): Promise<RedditMeta | null> {
  const res = await gatedFetch(`https://old.reddit.com/comments/${id}/`, {
    headers: { 'User-Agent': DESKTOP_UA },
  });
  dbg('html', res.status, res.ok);
  if (!res.ok) throw fromStatus(res.status, 'Reddit');
  const html = await res.text();

  const vid =
    html.match(/data-url="https?:\/\/v\.redd\.it\/([a-z0-9]+)"/iu) ??
    html.match(/v\.redd\.it\/([a-z0-9]+)/iu);
  if (!vid) return null;

  const author = html.match(/data-author="([^"]+)"/iu)?.[1];
  return {
    vid: vid[1],
    title: metaTag(html, 'og:title') || 'Reddit Video',
    uploader: author && author !== '[deleted]' ? author : 'Reddit',
    thumbnail: metaTag(html, 'og:image'),
  };
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
