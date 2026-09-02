import { Format, VideoInfo, ExtractorOptions } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { normalizeTitle, normalizeArtist } from './social.js';
import { DESKTOP_UA, estimateSize } from './util.js';
import { notFound, restricted, noVideo, fromStatus, classifyThrown, ExtractorError } from './errors.js';

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

function parseId(url: string): string | null {
  const m = url.match(/(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-z0-9]+)/iu);
  return m ? m[1] : null;
}

function pickThumb(thumbs?: Record<string, string>): string | undefined {
  if (!thumbs) return undefined;
  const entries = Object.entries(thumbs).sort((a, b) => Number(b[0]) - Number(a[0]));
  return entries[0]?.[1] ?? Object.values(thumbs)[0];
}

function dmError(error: NonNullable<DmMeta['error']>): ExtractorError {
  const code = String(error.code ?? '');
  if (code === '404') return notFound('Dailymotion');
  if (code === 'DM016') return restricted('Dailymotion', 'by its owner');
  return error.title ? new ExtractorError(`This Dailymotion video can't be loaded — ${error.title}.`, false) : noVideo('Dailymotion');
}

function hlsDurationSec(playlist: string): number {
  let total = 0;
  for (const match of playlist.matchAll(/#EXTINF:([\d.]+)/gu)) total += Number(match[1]);
  return Number.isFinite(total) ? total : 0;
}

async function fetchHlsVariants(
  env: ExtractorEnv,
  masterUrl: string,
  durationSec: number,
  headers: Record<string, string>
): Promise<Format[]> {
  try {
    const res = await env.fetch(masterUrl, { headers });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/u);
    const formats: Format[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const dims = lines[i].match(/RESOLUTION=(\d+)x(\d+)/u);
      const uri = lines[i + 1]?.trim();
      if (!dims || !uri || uri.startsWith('#')) continue;
      const height = Number(dims[2]);
      if (seen.has(height)) continue;
      seen.add(height);
      const bw = Number(
        lines[i].match(/AVERAGE-BANDWIDTH=(\d+)/u)?.[1] ??
          lines[i].match(/BANDWIDTH=(\d+)/u)?.[1] ??
          0
      );
      let absolute: string;
      try {
        absolute = new URL(uri, masterUrl).toString();
      } catch {
        continue;
      }
      formats.push({
        formatId: `${height}p`,
        url: absolute,
        extension: 'mp4',
        resolution: `${dims[1]}x${dims[2]}`,
        quality: `${height}p`,
        width: Number(dims[1]),
        height,
        filesize: estimateSize(bw, durationSec) ?? estimateSize(bw, hlsDurationSec(text)),
        vcodec: 'h264',
        acodec: 'aac',
        isMuxed: true,
        isVideo: true,
        isAudio: false,
        isHls: true,
        hlsKeepAlive: true,
      });
    }
    formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return formats;
  } catch {
    return [];
  }
}

export function createDailymotionExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, _opts: ExtractorOptions = {}): Promise<VideoInfo | null> {
    const id = parseId(url);
    if (!id) return null;
    try {
      const res = await env.fetch(
        `https://www.dailymotion.com/player/metadata/video/${id}`,
        { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } }
      );
      if (!res.ok) throw fromStatus(res.status, 'Dailymotion');
      const meta = (await res.json()) as DmMeta;
      if (meta.error) throw dmError(meta.error);
      const master = meta.qualities?.auto?.[0]?.url;
      if (!master) throw noVideo('Dailymotion');

      let formats = await fetchHlsVariants(env, master, meta.duration ?? 0, {
        'User-Agent': DESKTOP_UA,
        Referer: REFERER,
      });
      if (formats.length === 0) {
        formats = [
          {
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
            note: 'hls m3u8',
          },
        ];
      }

      const info: VideoInfo = {
        type: 'video',
        id: String(meta.id ?? id),
        title: meta.title ?? 'Dailymotion Video',
        uploader: meta.owner?.screenname ?? meta.owner?.username ?? 'Dailymotion',
        webpageUrl: url,
        thumbnail: pickThumb(meta.thumbnails),
        duration: meta.duration,
        formats,
        extractorKey: 'dailymotion',
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
      throw classifyThrown(error, 'Dailymotion');
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const selected =
      videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ??
      videoInfo.formats[0];
    if (!selected?.url) throw new Error('No stream URL');
    if (selected.isHls || selected.url.includes('.m3u8')) {
      if (!env.remuxHls) throw new Error('HLS needs remuxHls');
      return env.remuxHls(selected.url, {});
    }
    return env.streamUrl(selected.url, {});
  }

  return { getInfo, getStream };
}
