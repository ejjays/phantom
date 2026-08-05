import Innertube, { ClientType } from 'youtubei.js';
import { BG } from 'bgutils-js';
import { urlOf } from '../net';
import type { VideoInfo, Format } from '@shared/schemas/media.schema.js';

const PO_TOKEN_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const YT_ORIGIN = 'https://www.youtube.com';
const BOOTSTRAP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const YT_ID_REGEX =
  /(?:v=|\/v\/|youtu\.be\/|shorts\/|live\/|embed\/)([0-9A-Za-z_-]{11})/u;

interface YtFormat {
  itag?: number;
  url?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  quality_label?: string;
  audio_quality?: string;
  content_length?: number;
  has_audio?: boolean;
  has_video?: boolean;
}

interface ProxyFetchOptions {
  proxyBase: string;
}

interface ArmedClient {
  yt: Innertube;
  poToken: string | null;
  expiresAt: number;
}

// minimal shape of bgutils-js BgConfig (not re-exported from package root)
interface BotGuardConfig {
  fetch: typeof fetch;
  globalObj: Record<string, unknown>;
  identifier: string;
  requestKey: string;
  useYouTubeAPI?: boolean;
}

let _proxyFetch: typeof fetch | null = null;

function isYouTubeHost(host: string): boolean {
  return /^(.+\.)?youtube\.com$/u.test(host) || host === 'youtu.be';
}

function isMediaHost(host: string): boolean {
  return (
    /^(.+\.)?googlevideo\.com$/u.test(host) || /^(.+\.)?ytimg\.com$/u.test(host)
  );
}

function shouldProxy(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return isYouTubeHost(host) || isMediaHost(host);
  } catch {
    return false;
  }
}

export function createProxyFetch(opts: ProxyFetchOptions): typeof fetch {
  const { proxyBase } = opts;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = urlOf(input);
    if (!rawUrl || !shouldProxy(rawUrl)) {
      return fetch(input, init);
    }
    // youtubei's HTTPClient passes (Request, { body, headers, redirect, credentials });
    // method lives on the Request, headers is a Headers instance (not spreadable)
    const hdrs = new Headers(init?.headers);
    hdrs.set('User-Agent', BOOTSTRAP_UA);
    hdrs.set('Origin', YT_ORIGIN);
    hdrs.set('Referer', `${YT_ORIGIN}/`);
    return fetch(`${proxyBase}/proxy?u=${encodeURIComponent(rawUrl)}`, {
      method: init?.method ?? (input instanceof Request ? input.method : undefined),
      headers: hdrs,
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      redirect: init?.redirect ?? (input instanceof Request ? input.redirect : undefined),
      credentials: 'omit',
    });
  };
}

export function setProxyFetch(fetchImpl: typeof fetch): void {
  _proxyFetch = fetchImpl;
}

export function getProxyFetch(): typeof fetch {
  if (!_proxyFetch) {
    throw new Error('proxyFetch not initialized');
  }
  return _proxyFetch;
}

let armed: ArmedClient | null = null;
let arming: Promise<ArmedClient> | null = null;

async function makePoToken(
  visitorData: string,
  proxyFetch: typeof fetch
): Promise<{ poToken: string; ttlMs: number } | null> {
  const bgConfig: BotGuardConfig = {
    fetch: proxyFetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: PO_TOKEN_REQUEST_KEY,
  };
  try {
    const challenge = await BG.Challenge.create(bgConfig);
    if (!challenge) return null;
    const script = challenge.interpreterJavascript
      .privateDoNotAccessOrElseSafeScriptWrappedValue as string;
    if (script) {
      // eslint-disable-next-line sonarjs/code-eval
      const fn = new Function(script);
      fn();
    }
    const out = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig,
    });
    const ttlSecs = out.integrityTokenData?.estimatedTtlSecs;
    return {
      poToken: out.poToken,
      ttlMs: ttlSecs ? ttlSecs * 1000 : 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`po token failed: ${msg}`);
  }
}

async function armClient(proxyFetch: typeof fetch): Promise<ArmedClient> {
  const bootstrap = await Innertube.create({
    retrieve_player: false,
    fetch: proxyFetch,
    generate_session_locally: true,
  });
  const visitorData = bootstrap.session.context.client.visitorData || undefined;

  let poToken: string | null = null;
  let ttlMs = 0;
  try {
    const tok = await makePoToken(visitorData || '', proxyFetch);
    if (tok) {
      poToken = tok.poToken;
      ttlMs = tok.ttlMs;
    }
  } catch {
    // PO token is best-effort; ANDROID_VR often works without it
  }

  const yt = await Innertube.create({
    po_token: poToken || undefined,
    visitor_data: visitorData,
    generate_session_locally: true,
    fetch: proxyFetch,
    client_type: ClientType.ANDROID_VR,
  });

  const lifeMs = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  return {
    yt,
    poToken,
    expiresAt: Date.now() + Math.max(lifeMs - REFRESH_MARGIN_MS, 60000),
  };
}

function getArmedClient(proxyFetch: typeof fetch): Promise<ArmedClient> {
  if (armed && Date.now() < armed.expiresAt) return Promise.resolve(armed);
  if (arming) return arming;
  arming = armClient(proxyFetch)
    .then((bundle) => {
      armed = bundle;
      return bundle;
    })
    .finally(() => {
      arming = null;
    });
  return arming;
}

function videoCodecOf(mimeType: string | undefined): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('av01')) return 'av1';
  if (mime.includes('vp9') || mime.includes('vp09')) return 'vp9';
  if (mime.includes('avc1') || mime.includes('avc3')) return 'h264';
  return mime.includes('webm') ? 'vp9' : 'h264';
}

function pickBestAudio(
  audios: YtFormat[],
  container: 'mp4' | 'webm'
): YtFormat | undefined {
  return audios
    .filter((a) => a.mime_type?.includes(container))
    .sort((x, y) => (y.bitrate ?? 0) - (x.bitrate ?? 0))[0];
}

function formatFromYt(raw: YtFormat, index: number): Format | null {
  const url = typeof raw.url === 'string' && raw.url ? raw.url : undefined;
  if (!url) return null;
  const mime = raw.mime_type || '';
  const webm = mime.includes('webm');
  const ext = raw.has_video ? (webm ? 'webm' : 'mp4') : webm ? 'webm' : 'm4a';
  const kbps = raw.bitrate ? Math.round(raw.bitrate / 1000) : undefined;
  return {
    formatId: String(raw.itag ?? `yt_${index}`),
    url,
    extension: ext,
    resolution:
      raw.quality_label || (raw.height ? `${raw.height}p` : undefined),
    quality:
      raw.quality_label ||
      (raw.has_audio && !raw.has_video
        ? raw.audio_quality || 'Audio'
        : undefined),
    width: raw.width,
    height: raw.height,
    tbr: kbps,
    vcodec: raw.has_video ? videoCodecOf(raw.mime_type) : 'none',
    acodec: raw.has_audio ? (webm ? 'opus' : 'aac') : 'none',
    isVideo: Boolean(raw.has_video),
    isAudio: Boolean(raw.has_audio),
    isMuxed: Boolean(raw.has_video && raw.has_audio),
    filesize: raw.content_length,
  };
}

interface OnPartialMeta {
  id: string;
  title?: string;
  author?: string;
  duration?: number;
  thumbnail?: string;
}

interface YtStreamInfo {
  formats?: YtFormat[];
  adaptive_formats?: YtFormat[];
}

interface YtBasicInfo {
  title?: string;
  author?: string;
  duration?: number;
  thumbnail?: { url: string }[];
}

interface YtInfo {
  basic_info?: YtBasicInfo;
  streaming_data?: YtStreamInfo;
}

async function fetchInfo(yt: Innertube, videoId: string): Promise<YtInfo> {
  try {
    return (await yt.getInfo(videoId, { client: 'WEB' })) as unknown as YtInfo;
  } catch {
    try {
      return (await yt.getInfo(videoId, {
        client: 'ANDROID_VR',
      })) as unknown as YtInfo;
    } catch (vrErr: unknown) {
      const msg = vrErr instanceof Error ? vrErr.message : String(vrErr);
      throw new Error(`YouTube extraction failed: ${msg}`);
    }
  }
}

function buildFormats(sd: YtStreamInfo | undefined): {
  formats: Format[];
  audioFormats: Format[];
} {
  const rawFormats: YtFormat[] = [
    ...(sd?.formats || []).filter((f) => f.url),
    ...(sd?.adaptive_formats || []).filter((f) => f.url),
  ];
  // cast needed: filter returns same elem type
  const raw = rawFormats as YtFormat[];

  const muxed = raw.filter((f) => f.has_video && f.has_audio);
  const videoOnly = raw.filter((f) => f.has_video && !f.has_audio);
  const audioOnly = raw.filter((f) => f.has_audio && !f.has_video);

  const aac = pickBestAudio(audioOnly, 'mp4');
  const opus = pickBestAudio(audioOnly, 'webm');

  const byHeight = new Map<number, YtFormat>();
  for (const video of videoOnly) {
    const height = video.height ?? 0;
    const current = byHeight.get(height);
    if (!current || videoCodecOf(video.mime_type) === 'h264') {
      byHeight.set(height, video);
    }
  }

  const ladder = new Map<number, Format>();
  muxed.forEach((fmt, i) => {
    const format = formatFromYt(fmt, 1000 + i);
    if (format?.height) ladder.set(format.height, format);
  });

  let index = 0;
  for (const video of byHeight.values()) {
    const height = video.height ?? 0;
    if (ladder.has(height)) continue;
    const audio = aac ?? opus;
    if (!audio?.url) continue;
    const format = formatFromYt(video, index++);
    if (!format) continue;
    format.extension = 'mp4';
    format.audioUrl = audio.url;
    const sum = video.content_length ?? 0;
    const audioBytes = audio.content_length ?? 0;
    format.filesize = sum + audioBytes > 0 ? sum + audioBytes : undefined;
    ladder.set(height, format);
  }

  const formats: Format[] = [...ladder.values()].sort(
    (lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0)
  );

  const audioFormats: Format[] = [];
  if (aac) {
    const base = formatFromYt(aac, 2000);
    if (base) {
      audioFormats.push({ ...base, quality: 'Original' });
      const mp3Raw = opus ?? aac;
      const mp3Bytes = mp3Raw.content_length ?? base.filesize;
      audioFormats.push({
        ...base,
        formatId: 'mp3',
        url: mp3Raw.url || base.url,
        extension: 'mp3',
        acodec: 'mp3',
        quality: 'MP3',
        filesize: mp3Bytes,
      });
    }
  }

  return { formats, audioFormats };
}

export async function extractYouTube(
  url: string,
  onPartial?: (meta: OnPartialMeta) => void
): Promise<VideoInfo | null> {
  const match = url.match(YT_ID_REGEX);
  const videoId = match ? match[1] : null;
  if (!videoId) return null;

  const proxyFetch = getProxyFetch();
  const bundle = await getArmedClient(proxyFetch);
  const yt = bundle.yt;

  onPartial?.({
    id: videoId,
    title: '',
    author: '',
    duration: undefined,
    thumbnail: undefined,
  });

  const info = await fetchInfo(yt, videoId);
  const bi = info.basic_info || {};
  onPartial?.({
    id: videoId,
    title: bi.title,
    author: bi.author,
    duration: bi.duration,
    thumbnail: bi.thumbnail?.[0]?.url,
  });

  const { formats, audioFormats } = buildFormats(info.streaming_data);

  if (formats.length === 0 && audioFormats.length === 0) {
    throw new Error('YouTube: no formats found (video may be unavailable)');
  }

  return {
    id: videoId,
    type: 'video',
    title: bi.title || 'YouTube Video',
    artist: bi.author,
    uploader: bi.author || 'YouTube',
    webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: bi.thumbnail?.[0]?.url,
    duration: bi.duration,
    formats,
    audioFormats,
    extractorKey: 'youtube',
    isJsInfo: true,
    isPartial: false,
    isIsrcMatch: false,
    isFullData: true,
    fromBrain: false,
  };
}
