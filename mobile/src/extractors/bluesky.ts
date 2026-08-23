import { VideoInfo, Format } from './shared/types';
import { normalizeTitle, normalizeArtist } from './shared/utils';
import { gatedFetch } from '../lib/net';
import { noVideo, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError } from '../lib/log';
import { buildVideoInfo } from './shared/videoInfo';

const APPVIEW = 'https://public.api.bsky.app/xrpc';

interface AspectRatio {
  width?: number;
  height?: number;
}
interface VideoView {
  playlist?: string;
  thumbnail?: string;
  aspectRatio?: AspectRatio;
}
interface BskyEmbedView extends VideoView {
  $type?: string;
  media?: VideoView;
}
interface QuotedRef {
  uri?: string;
  record?: { uri?: string };
}
interface BskyPost {
  record?: { text?: string; embed?: { record?: QuotedRef } };
  embed?: BskyEmbedView;
  author?: { displayName?: string; handle?: string };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await gatedFetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// view holds cdn playlist + thumb
function videoView(post: BskyPost | undefined): VideoView | null {
  const view = post?.embed;
  if (view?.playlist) return view;
  if (view?.media?.playlist) return view.media;
  return null;
}

// quote-posts hold video in quote
function quotedUri(post: BskyPost | undefined): string | undefined {
  const rec = post?.record?.embed?.record;
  return rec?.uri ?? rec?.record?.uri;
}

async function resolveView(
  post: BskyPost | undefined
): Promise<{ view: VideoView; post: BskyPost } | null> {
  const direct = videoView(post);
  if (direct && post) return { view: direct, post };

  const quoted = quotedUri(post);
  const match = quoted?.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/u);
  if (!match) return null;
  const [, qDid, qRkey] = match;
  const qThread = await fetchJson<{ thread?: { post?: BskyPost } }>(
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(
      `at://${qDid}/app.bsky.feed.post/${qRkey}`
    )}`
  );
  const qPost = qThread?.thread?.post;
  const view = videoView(qPost);
  return view && qPost ? { view, post: qPost } : null;
}

interface Variant {
  url: string;
  width: number;
  height: number;
  bandwidth: number;
}

// one entry per quality variant
function parseMaster(master: string, masterUrl: string): Variant[] {
  const lines = master.split(/\r?\n/u);
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const rel = lines[i + 1]?.trim();
    if (!rel || rel.startsWith('#')) continue;
    const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/u);
    const bw = lines[i].match(/BANDWIDTH=(\d+)/u);
    out.push({
      url: new URL(rel, masterUrl).toString(),
      width: res ? Number(res[1]) : 0,
      height: res ? Number(res[2]) : 0,
      bandwidth: bw ? Number(bw[1]) : 0,
    });
  }
  return out;
}

// any variant gives runtime
async function fetchDuration(variants: Variant[]): Promise<number> {
  const smallest = [...variants].sort(
    (lhs, rhs) => lhs.bandwidth - rhs.bandwidth
  )[0];
  if (!smallest) return 0;
  try {
    const res = await gatedFetch(smallest.url, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) return 0;
    const text = await res.text();
    return [...text.matchAll(/#EXTINF:([\d.]+)/gu)].reduce(
      (sum, hit) => sum + Number(hit[1]),
      0
    );
  } catch {
    return 0;
  }
}

function buildFormats(variants: Variant[], durationSec: number): Format[] {
  const seen = new Set<number>();
  const formats: Format[] = [];
  for (const variant of variants) {
    const short =
      variant.width && variant.height
        ? Math.min(variant.width, variant.height)
        : 0;
    if (seen.has(short)) continue;
    seen.add(short);
    // hls has no size; estimate from bitrate
    const filesize =
      durationSec > 0 && variant.bandwidth
        ? Math.round((variant.bandwidth / 8) * durationSec)
        : undefined;
    formats.push({
      formatId: short ? `${short}p` : 'source',
      url: variant.url,
      extension: 'mp4',
      resolution:
        variant.width && variant.height
          ? `${variant.width}x${variant.height}`
          : undefined,
      quality: short ? `${short}p` : 'Source',
      width: variant.width || undefined,
      height: variant.height || undefined,
      tbr: variant.bandwidth ? Math.round(variant.bandwidth / 1000) : undefined,
      filesize,
      vcodec: 'h264',
      acodec: 'aac',
      isVideo: true,
      isAudio: false,
      isMuxed: true,
      isHls: true,
    });
  }
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

/**
 * getBlob = raw upload off slow pds origin (one quality); cdn serves
 * same clip as fast multi-quality hls, so take that & let ffmpeg-kit remux.
 */
export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const match = url.match(/profile\/([^/]+)\/post\/([^/?#]+)/u);
    if (!match) return null;
    const [, handle, rkey] = match;

    const resolved = await fetchJson<{ did?: string }>(
      `${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    const did = resolved?.did;
    if (!did) throw noVideo('Bluesky');

    const thread = await fetchJson<{ thread?: { post?: BskyPost } }>(
      `${APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(
        `at://${did}/app.bsky.feed.post/${rkey}`
      )}`
    );
    const post = thread?.thread?.post;

    const found = await resolveView(post);
    if (!found?.view.playlist) throw noVideo('Bluesky');

    const master = await gatedFetch(found.view.playlist, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!master.ok) throw fromStatus(master.status, 'Bluesky');
    const variants = parseMaster(await master.text(), found.view.playlist);
    if (variants.length === 0) throw noVideo('Bluesky');
    const duration = await fetchDuration(variants);
    const formats = buildFormats(variants, duration);
    if (formats.length === 0) throw noVideo('Bluesky');

    const info: VideoInfo = buildVideoInfo({
      id: rkey,
      title: post?.record?.text || 'Bluesky Video',
      uploader:
        post?.author?.displayName || post?.author?.handle || 'Bluesky User',
      webpageUrl: url,
      thumbnail: found.view.thumbnail,
      duration: duration || undefined,
      formats,
      extractorKey: 'bluesky',
      downloadHeaders: { 'User-Agent': DESKTOP_UA },
    });

    info.title = normalizeTitle(info as unknown as Record<string, unknown>);
    info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('bluesky', `[JS-Bluesky] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Bluesky');
  }
}
