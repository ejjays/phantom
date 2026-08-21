import { VideoInfo, Format, ExtractorError } from './shared/types';
import { gatedFetch } from '../lib/net';
import {
  notFound,
  restricted,
  noVideo,
  fromStatus,
  classifyThrown,
} from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, warn as logWarn } from '../lib/log';
import { parseHlsMaster, pickLargestThumb } from './shared/hls';
import { buildVideoInfo } from './shared/videoInfo';
const REFERER = 'https://www.dailymotion.com/';

interface DmStream {
  type?: string;
  url?: string;
}
interface DmMeta {
  id?: string;
  title?: string;
  duration?: number;
  owner?: { screenname?: string; username?: string };
  thumbnails?: Record<string, string>;
  qualities?: Record<string, DmStream[]>;
  error?: { title?: string; raw_message?: string; code?: string | number };
}

// map dailymotion's error code to a typed error
function dmError(error: NonNullable<DmMeta['error']>): ExtractorError {
  const code = String(error.code ?? '');
  if (code === '404') return notFound('Dailymotion');
  if (code === 'DM016') return restricted('Dailymotion', 'by its owner');
  return error.title
    ? new ExtractorError(
        `This Dailymotion video can't be loaded — ${error.title}.`,
        false
      )
    : noVideo('Dailymotion');
}

interface DmInfo {
  id: string;
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

function buildInfo(meta: DmInfo, url: string, formats: Format[]): VideoInfo {
  return buildVideoInfo({
    id: meta.id,
    title: meta.title || 'Dailymotion Video',
    uploader: meta.uploader || 'Dailymotion',
    webpageUrl: url,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    formats,
    extractorKey: 'dailymotion',
    downloadHeaders: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
  });
}

function parseId(url: string): string | null {
  const match = url.match(
    /(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-z0-9]+)/iu
  );
  return match ? match[1] : null;
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const id = parseId(url);
    if (!id) return null;

    const res = await gatedFetch(
      `https://www.dailymotion.com/player/metadata/video/${id}`,
      { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } }
    );
    if (!res.ok) throw fromStatus(res.status, 'Dailymotion');
    const meta = (await res.json()) as DmMeta;
    // publisher/geo restriction (e.g. DM016) -> surface why, not generic
    if (meta.error) {
      logWarn(
        'dailymotion',
        `[JS-Dailymotion] ${meta.error.code ?? '?'}: ${meta.error.raw_message ?? meta.error.title ?? ''}`
      );
      throw dmError(meta.error);
    }
    const master = meta.qualities?.auto?.[0]?.url;
    if (!master) throw noVideo('Dailymotion');

    const formats = await parseHlsMaster(master, meta.duration ?? 0, {
      'User-Agent': DESKTOP_UA,
      Referer: REFERER,
    });
    // master unparsed -> pass the master playlist through as-is
    if (formats.length === 0) {
      formats.push({
        formatId: 'auto',
        url: master,
        extension: 'mp4',
        quality: 'Auto',
        vcodec: 'h264',
        acodec: 'aac',
        isVideo: true,
        isAudio: false,
        isMuxed: true,
        isHls: true,
        hlsKeepAlive: true,
      });
    }

    return buildInfo(
      {
        id: meta.id || id,
        title: meta.title,
        uploader: meta.owner?.screenname,
        duration: meta.duration,
        thumbnail: pickLargestThumb(meta.thumbnails),
      },
      url,
      formats
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(
      'dailymotion',
      `[JS-Dailymotion] Error extracting ${url}: ${message}`
    );
    throw classifyThrown(error, 'Dailymotion');
  }
}
