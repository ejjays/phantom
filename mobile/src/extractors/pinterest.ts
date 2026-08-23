import { VideoInfo, Format } from './shared/types';
import { gatedFetch } from '../lib/net';
import { notFound, noVideo, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError } from '../lib/log';
import { decodeEntities } from './shared/utils';
import { buildVideoInfo } from './shared/videoInfo';

const REFERER = 'https://www.pinterest.com/';
const PIDGETS_API = 'https://widgets.pinterest.com/v3/pidgets/pins/info/';

interface PinVideoEntry {
  url?: string;
  width?: number;
  height?: number;
  duration?: number; // ms
  thumbnail?: string;
}
interface PinVideos {
  video_list?: Record<string, PinVideoEntry>;
}
interface PinStoryBlock {
  type?: string;
  video?: PinVideos;
}
interface PinStoryPage {
  blocks?: PinStoryBlock[];
}
interface PidgetsPin {
  id?: string;
  description?: string;
  is_video?: boolean;
  pinner?: { username?: string | null; full_name?: string | null };
  native_creator?: { username?: string | null; full_name?: string | null };
  rich_metadata?: { title?: string | null };
  videos?: PinVideos | null;
  story_pin_data?: { pages?: PinStoryPage[] } | null;
}
interface PidgetsResponse {
  status?: string;
  data?: (PidgetsPin | null)[] | null;
}

// descriptions double as titles; keep them one line and readable
function titleFrom(pin: PidgetsPin): string {
  const raw = pin.rich_metadata?.title || pin.description || '';
  const clean = decodeEntities(raw).replace(/\s+/gu, ' ').trim();
  if (!clean) return 'Pinterest Video';
  if (clean.length <= 100) return clean;
  const cut = clean.slice(0, 100);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60))}…`;
}

function uploaderFrom(pin: PidgetsPin): string {
  return (
    pin.native_creator?.full_name ||
    pin.native_creator?.username ||
    pin.pinner?.full_name ||
    pin.pinner?.username ||
    'Pinterest'
  );
}

export function parsePinId(url: string): string | null {
  const match = url.match(
    /(?:^|\.)pinterest\.[a-z.]{2,7}\/pin\/(?:[\w-]+--)?(\d+)/iu
  );
  return match ? match[1] : null;
}

function isPinterestHost(url: string): boolean {
  const host = url
    .replace(/^https?:\/\//iu, '')
    .split(/[/?#]/u)[0]
    .toLowerCase();
  if (host === 'pin.it') return true;
  return /(?:^|\.)pinterest\.(?:[a-z]{2,4}|com?\.[a-z]{2})$/u.test(host);
}

// pin.it redirects to /pin/<id>; HEAD first (skip page body), GET fallback (some refuse HEAD)
async function resolveShortLink(url: string): Promise<string> {
  try {
    const res = await gatedFetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (res.ok || res.status < 400) return res.url || url;
  } catch {
    // some servers refuse HEAD; GET fallback below
  }
  const res = await gatedFetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': DESKTOP_UA },
  });
  return res.url || url;
}

// direct mp4 renditions first (fast path), hls master only as fallback
function buildFormats(videoList: Record<string, PinVideoEntry>): Format[] {
  const mp4s: Format[] = [];
  let hls: Format | null = null;
  const seenHeights = new Set<number>();

  for (const [key, entry] of Object.entries(videoList)) {
    if (!entry.url) continue;
    if (/\.m3u8/u.test(entry.url)) {
      hls ??= {
        formatId: 'hls-auto',
        url: entry.url,
        extension: 'mp4',
        quality: 'Auto',
        width: entry.width,
        height: entry.height,
        vcodec: 'h264',
        acodec: 'aac',
        isVideo: true,
        isAudio: true,
        isMuxed: true,
        isHls: true,
        hlsKeepAlive: true,
      };
      continue;
    }
    const height = entry.height ?? 0;
    if (height > 0 && seenHeights.has(height)) continue;
    if (height > 0) seenHeights.add(height);
    mp4s.push({
      formatId: height > 0 ? `${height}p` : key.toLowerCase(),
      url: entry.url,
      extension: 'mp4',
      resolution:
        entry.width && entry.height
          ? `${entry.width}x${entry.height}`
          : undefined,
      quality: height > 0 ? `${height}p` : undefined,
      width: entry.width,
      height: entry.height,
      vcodec: 'h264',
      acodec: 'aac',
      isVideo: true,
      isAudio: true,
      isMuxed: true,
    });
  }

  mp4s.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  if (mp4s.length === 0 && hls) return [hls];
  return mp4s;
}

// regular video pins carry pin.videos; idea (story) pins nest per-page blocks
function pickVideoList(pin: PidgetsPin): Record<string, PinVideoEntry> | null {
  const direct = pin.videos?.video_list;
  if (direct && Object.keys(direct).length > 0) return direct;
  for (const page of pin.story_pin_data?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      const list = block.video?.video_list;
      if (list && Object.keys(list).length > 0) return list;
    }
  }
  return null;
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  if (!isPinterestHost(url)) return null;
  try {
    const isShortLink = /(?:^|\/\/)pin\.it\//iu.test(url);
    let target = url;
    if (isShortLink) {
      target = await resolveShortLink(url);
    }
    const id = parsePinId(target);
    if (!id) {
      // a pin.it link that no longer lands on /pin/<id>/ is dead or private
      if (isShortLink) throw notFound('Pinterest', 'pin');
      return null;
    }

    const res = await gatedFetch(
      `${PIDGETS_API}?pin_ids=${encodeURIComponent(id)}`,
      { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } }
    );
    if (!res.ok) throw fromStatus(res.status, 'Pinterest', 'pin');
    const body = (await res.json()) as PidgetsResponse;
    const pin = body.data?.[0];
    // pidgets answers 200 with an empty list for deleted/private pins
    if (!pin) throw notFound('Pinterest', 'pin');

    const videoList = pickVideoList(pin);
    if (!videoList) throw noVideo('Pinterest');
    const formats = buildFormats(videoList);
    if (formats.length === 0) throw noVideo('Pinterest');

    const first = Object.values(videoList).find((entry) => entry.url);
    const durationMs = first?.duration ?? 0;

    return buildVideoInfo({
      id: pin.id || id,
      title: titleFrom(pin),
      uploader: uploaderFrom(pin),
      webpageUrl: `https://www.pinterest.com/pin/${id}/`,
      thumbnail: first?.thumbnail,
      duration: durationMs > 0 ? Math.round(durationMs / 1000) : undefined,
      formats,
      extractorKey: 'pinterest',
      downloadHeaders: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('pinterest', `[JS-Pinterest] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Pinterest');
  }
}
