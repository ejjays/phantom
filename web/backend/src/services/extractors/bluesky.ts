import { spawn } from 'node:child_process';
import { logger } from '../../utils/infra/logger.util.js';
import { Readable } from 'node:stream';
import { secureFetch } from '../../utils/network/security.util.js';
import { VideoInfo, Format, ExtractorOptions } from '../../types/index.js';
import { normalizeTitle, normalizeArtist } from '../social.service.js';

const APPVIEW = 'https://public.api.bsky.app/xrpc';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
  const res = await secureFetch(url);
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

function buildFormats(variants: Variant[]): Format[] {
  const seen = new Set<number>();
  const formats: Format[] = [];
  for (const variant of variants) {
    const short =
      variant.width && variant.height
        ? Math.min(variant.width, variant.height)
        : 0;
    if (seen.has(short)) continue;
    seen.add(short);
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
      vcodec: 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: false,
      note: 'hls m3u8',
    });
  }
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

async function resolveView(
  post: BskyPost | undefined
): Promise<{ view: VideoView; post: BskyPost } | null> {
  const direct = videoView(post);
  if (direct && post) return { view: direct, post };

  // follow quote to its video
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

/**
 * getBlob = raw upload off slow pds origin (one quality); cdn serves
 * same clip as fast multi-quality hls, so take that & let ffmpeg remux.
 */
export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    const match = url.match(/profile\/([^/]+)\/post\/([^/?#]+)/u);
    if (!match) return null;
    const [, handle, rkey] = match;

    const resolved = await fetchJson<{ did?: string }>(
      `${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    const did = resolved?.did;
    if (!did) return null;

    const thread = await fetchJson<{ thread?: { post?: BskyPost } }>(
      `${APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(
        `at://${did}/app.bsky.feed.post/${rkey}`
      )}`
    );
    const post = thread?.thread?.post;

    const found = await resolveView(post);
    if (!found?.view.playlist) return null; // no video -> yt-dlp fallback

    const master = await secureFetch(found.view.playlist, {
      headers: { 'User-Agent': UA },
    });
    if (!master.ok) return null;
    const formats = buildFormats(
      parseMaster(await master.text(), found.view.playlist)
    );
    if (formats.length === 0) return null;

    const info: VideoInfo = {
      type: 'video',
      id: rkey,
      title: post?.record?.text || 'Bluesky Video',
      uploader:
        post?.author?.displayName || post?.author?.handle || 'Bluesky User',
      webpageUrl: url,
      thumbnail: found.view.thumbnail,
      formats,
      extractorKey: 'bluesky',
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
    logger.error(`[JS-Bluesky] Error extracting ${url}: ${message}`);
    return null;
  }
}

/* hls variant -> fragmented mp4 stream, no re-encode */
export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const selected =
    videoInfo.formats.find(
      (format) => String(format.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!selected?.url) throw new Error('No stream URL found');

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-http_persistent',
      '0',
      '-user_agent',
      UA,
      '-i',
      selected.url,
      '-c',
      'copy',
      '-bsf:a',
      'aac_adtstoasc',
      '-f',
      'mp4',
      '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration',
      '1000000',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  (ffmpeg.stdio[2] as Readable | null)?.resume();
  ffmpeg.on('error', (err: Error) =>
    logger.error(`[JS-Bluesky] ffmpeg error: ${err.message}`)
  );

  return Promise.resolve(ffmpeg.stdout as Readable);
}
