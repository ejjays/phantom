import { Format, VideoInfo, ExtractorOptions } from './shared/types.js';
import { ExtractorEnv, defaultEnv } from './shared/env.js';
import { normalizeTitle, normalizeArtist } from './shared/social.js';
import { DESKTOP_UA, estimateSize } from './shared/util.js';
import { noVideo, notFound, classifyThrown } from './shared/errors.js';

const REFERER = 'https://www.twitch.tv/';
const CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const GQL_URL = 'https://gql.twitch.tv/gql';
const HASH_SHARE_CLIP_RENDER_STATUS = '0a02bb974443b576f5579aab0fef1d4b7f44e58a8a256f0c5adfead0db70640f';
const HASH_VIDEO_METADATA = '45111672eea2e507f8ba44d101a61862f9c56b11dee09a15634cb75cb9b9084d';

interface TwitchClipAsset {
  aspectRatio?: number | null;
  thumbnailURL?: string | null;
  videoQualities?: Array<{ quality: string; frameRate?: number | null; sourceURL: string }>;
}
interface TwitchClip {
  id?: string;
  title?: string;
  durationSeconds?: number | null;
  thumbnailURL?: string | null;
  playbackAccessToken?: { signature?: string; value?: string } | null;
  assets?: TwitchClipAsset[];
  broadcaster?: { displayName?: string };
  curator?: { displayName?: string };
}
interface TwitchVodMetadata {
  id?: string;
  title?: string;
  lengthSeconds?: number;
  previewThumbnailURL?: string | null;
  owner?: { displayName?: string; login?: string };
}

function parseClipId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'clip.twitch.tv' || parsed.hostname.endsWith('.clip.twitch.tv')) {
      const clip = parsed.searchParams.get('clip');
      if (clip && /^[a-zA-Z0-9_-]+$/u.test(clip)) return clip;
      const seg = parsed.pathname.split('/').filter(Boolean).pop();
      if (seg && /^[a-zA-Z0-9_-]+$/u.test(seg)) return seg;
    }
  } catch {
    /* not a valid URL, fall through to regex */
  }
  const patterns = [
    /twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/u,
    /twitch\.tv\/clip\/([a-zA-Z0-9_-]+)/u,
    /clip\.twitch\.tv\/(?:embed\?.*?\bclip=)?([a-zA-Z0-9_-]+)/u,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseVodId(url: string): string | null {
  const m = url.match(/twitch\.tv\/(?:[^/]+\/)?v(?:ideos?)?\/(\d+)/u);
  return m ? m[1] : null;
}

function signClipUrl(sourceUrl: string, sig?: string, token?: string): string {
  if (!sig || !token) return sourceUrl;
  try {
    const u = new URL(sourceUrl);
    u.searchParams.set('sig', sig);
    u.searchParams.set('token', token);
    return u.toString();
  } catch {
    const sep = sourceUrl.includes('?') ? '&' : '?';
    return `${sourceUrl}${sep}sig=${encodeURIComponent(sig)}&token=${encodeURIComponent(token)}`;
  }
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function buildProgressiveFormats(assets: TwitchClipAsset[] | undefined, sig?: string, token?: string): Format[] {
  const formats: Format[] = [];
  if (!assets) return formats;
  const seen = new Set<string>();
  for (let ai = 0; ai < assets.length; ai++) {
    const asset = assets[ai];
    const isPortrait = ai > 0;
    for (const vq of asset.videoQualities ?? []) {
      const h = num(vq.quality);
      const frameRate = num(vq.frameRate);
      const fid = isPortrait ? `portrait-${vq.quality}` : vq.quality;
      if (seen.has(fid)) continue;
      seen.add(fid);
      formats.push({
        formatId: fid,
        url: signClipUrl(vq.sourceURL, sig, token),
        extension: 'mp4',
        quality: `${vq.quality}p${frameRate && frameRate >= 59 ? Math.round(frameRate) : ''}`.trim(),
        width: h && asset.aspectRatio ? Math.round(h * asset.aspectRatio) : undefined,
        height: Number.isFinite(h) ? h : undefined,
        vcodec: 'h264',
        acodec: 'aac',
        isVideo: true,
        isAudio: false,
        isMuxed: true,
      });
    }
  }
  formats.sort((a, b) => {
    const ap = a.formatId.startsWith('portrait') ? 1 : 0;
    const bp = b.formatId.startsWith('portrait') ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return (b.height ?? 0) - (a.height ?? 0);
  });
  return formats;
}

async function gqlPost(env: ExtractorEnv, operationName: string, hash: string, variables: Record<string, unknown>): Promise<{ status: number; body: string }> {
  try {
    const res = await env.fetch(GQL_URL, {
      method: 'POST',
      headers: { 'User-Agent': DESKTOP_UA, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', Referer: REFERER },
      body: JSON.stringify([{ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }]),
    });
    if (!res.ok) return { status: res.status, body: '' };
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

async function gqlInline(env: ExtractorEnv, query: string): Promise<{ status: number; body: string }> {
  try {
    const res = await env.fetch(GQL_URL, {
      method: 'POST',
      headers: { 'User-Agent': DESKTOP_UA, 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8', Referer: REFERER },
      body: JSON.stringify([{ query }]),
    });
    if (!res.ok) return { status: res.status, body: '' };
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

async function fetchFileSize(env: ExtractorEnv, url: string): Promise<number | undefined> {
  try {
    const res = await env.fetch(url, { method: 'HEAD', headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } });
    if (!res.ok) return undefined;
    const len = res.headers.get('content-length');
    return len ? parseInt(len, 10) : undefined;
  } catch {
    return undefined;
  }
}

function toVideoInfo(base: Omit<VideoInfo, 'title' | 'uploader'> & { title?: string; uploader?: string }): VideoInfo {
  const info = base as VideoInfo;
  info.title = normalizeTitle(info as unknown as Record<string, unknown>);
  info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);
  return info;
}

async function parseHlsMaster(env: ExtractorEnv, masterUrl: string, durationSec?: number): Promise<Format[]> {
  let text: string;
  try {
    const res = await env.fetch(masterUrl, { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const formats: Format[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith('#')) continue;
    const dims = line.match(/RESOLUTION=(\d+)x(\d+)/u);
    if (!dims) continue;
    const width = Number(dims[1]);
    const height = Number(dims[2]);
    if (seen.has(height)) continue;
    seen.add(height);
    const bandwidth = Number(line.match(/AVERAGE-BANDWIDTH=(\d+)/u)?.[1] ?? line.match(/BANDWIDTH=(\d+)/u)?.[1] ?? 0);
    const frameRate = Number(line.match(/FRAME-RATE=([\d.]+)/u)?.[1] ?? '0');
    const codecs = line.match(/CODECS="([^"]+)"/u)?.[1] ?? '';
    let vcodec: string | undefined = 'h264';
    if (/av01/u.test(codecs)) vcodec = 'av1';
    else if (/hvc1|hev1/u.test(codecs)) vcodec = 'hevc';
    const fid = `${height}p${frameRate >= 59 ? Math.round(frameRate) : ''}`.trim();
    formats.push({
      formatId: fid,
      url: new URL(uri, masterUrl).toString(),
      extension: 'mp4',
      resolution: `${width}x${height}`,
      quality: fid,
      width,
      height,
      tbr: Math.round(bandwidth / 1000),
      vcodec,
      acodec: 'aac',
      isVideo: true,
      isAudio: false,
      isMuxed: true,
      isHls: true,
      hlsKeepAlive: true,
      filesize: durationSec ? estimateSize(bandwidth, durationSec) : undefined,
    });
  }
  formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return formats;
}

export function createTwitchExtractor(env: ExtractorEnv = defaultEnv) {
  async function extractClip(slug: string, url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
    const gql = await gqlPost(env, 'ShareClipRenderStatus', HASH_SHARE_CLIP_RENDER_STATUS, { slug });
    let clip: TwitchClip | null = null;
    try {
      if (gql.body) clip = (JSON.parse(gql.body) as Array<{ data?: { clip?: TwitchClip | null } }>)?.[0]?.data?.clip ?? null;
    } catch {
      clip = null;
    }
    if (!clip) {
      if (gql.status === 200) throw notFound('Twitch', 'clip');
      throw noVideo('Twitch', 'clip');
    }
    const formats = buildProgressiveFormats(clip.assets, clip.playbackAccessToken?.signature, clip.playbackAccessToken?.value);
    if (formats.length === 0) throw noVideo('Twitch', 'clip');
    const info = toVideoInfo({
      type: 'video',
      id: clip.id ?? slug,
      title: clip.title ?? 'Twitch Clip',
      uploader: clip.curator?.displayName ?? clip.broadcaster?.displayName ?? 'Twitch',
      webpageUrl: url,
      thumbnail: clip.thumbnailURL ?? clip.assets?.[0]?.thumbnailURL ?? undefined,
      duration: num(clip.durationSeconds) !== undefined ? Math.round(num(clip.durationSeconds) as number) : undefined,
      formats,
      extractorKey: 'twitch',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: true,
    });
    try {
      (options as { onPartial?: (info: VideoInfo) => void }).onPartial?.(info);
    } catch {
      /* paint is best-effort */
    }
    for (let i = 0; i < formats.length; i += 3) {
      await Promise.all(
        formats.slice(i, i + 3).map(async (format) => {
          if (!format.url || format.filesize) return;
          const size = await fetchFileSize(env, format.url);
          if (size) format.filesize = size;
        })
      );
    }
    return info;
  }

  async function extractVod(vodId: string, url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
    const onPartial = (options as { onPartial?: (info: VideoInfo) => void }).onPartial;
    const metaGql = await gqlPost(env, 'VideoMetadata', HASH_VIDEO_METADATA, { videoID: vodId, channelLogin: '' });
    let vod: TwitchVodMetadata | null = null;
    try {
      if (metaGql.body) vod = (JSON.parse(metaGql.body) as Array<{ data?: { video?: TwitchVodMetadata | null } }>)?.[0]?.data?.video ?? null;
    } catch {
      vod = null;
    }
    if (!vod) {
      if (metaGql.status === 200) throw notFound('Twitch', 'VOD');
      throw noVideo('Twitch', 'VOD');
    }
    const duration = num(vod.lengthSeconds) !== undefined ? Math.round(num(vod.lengthSeconds) as number) : undefined;
    try {
      onPartial?.({
        type: 'video',
        id: vod.id ?? vodId,
        title: vod.title ?? 'Twitch VOD',
        uploader: vod.owner?.displayName ?? 'Twitch',
        webpageUrl: url,
        thumbnail: vod.previewThumbnailURL ?? undefined,
        duration,
        formats: [],
        extractorKey: 'twitch',
        isJsInfo: true,
        fromBrain: false,
        isPartial: true,
        isIsrcMatch: false,
        isFullData: false,
      });
    } catch {
      /* paint is best-effort */
    }
    const tokenGql = await gqlInline(
      env,
      `{ videoPlaybackAccessToken(id: "${vodId}", params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature } }`
    );
    let value: string | undefined;
    let signature: string | undefined;
    try {
      if (tokenGql.body) {
        const token = (JSON.parse(tokenGql.body) as Array<{ data?: { videoPlaybackAccessToken?: { value?: string; signature?: string } | null } }>)?.[0]?.data?.videoPlaybackAccessToken ?? null;
        value = token?.value;
        signature = token?.signature;
      }
    } catch {
      value = undefined;
      signature = undefined;
    }
    if (!value || !signature) throw noVideo('Twitch', 'VOD');
    const usher = new URL(`https://usher.ttvnw.net/vod/${vodId}.m3u8`);
    usher.searchParams.set('allow_source', 'true');
    usher.searchParams.set('allow_audio_only', 'true');
    usher.searchParams.set('p', String(Math.floor(Math.random() * 10000000)));
    usher.searchParams.set('platform', 'web');
    usher.searchParams.set('player', 'twitchweb');
    usher.searchParams.set('sig', signature);
    usher.searchParams.set('token', value);
    const formats = await parseHlsMaster(env, usher.toString(), duration);
    if (formats.length === 0) throw noVideo('Twitch', 'VOD');
    return toVideoInfo({
      type: 'video',
      id: vod.id ?? vodId,
      title: vod.title ?? 'Twitch VOD',
      uploader: vod.owner?.displayName ?? 'Twitch',
      webpageUrl: url,
      thumbnail: vod.previewThumbnailURL ?? undefined,
      duration,
      formats,
      extractorKey: 'twitch',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: true,
    });
  }

  async function getInfo(url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
    try {
      const clipId = parseClipId(url);
      const vodId = parseVodId(url);
      if (!clipId && !vodId) throw noVideo('Twitch');
      if (clipId) return await extractClip(clipId, url, options);
      return await extractVod(vodId as string, url, options);
    } catch (error: unknown) {
      throw classifyThrown(error, 'Twitch');
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const sel = videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!sel?.url) throw new Error('No stream URL');
    if (sel.isHls || sel.url.includes('.m3u8')) {
      if (!env.remuxHls) throw new Error('HLS needs remuxHls');
      return env.remuxHls(sel.url, {});
    }
    return env.streamUrl(sel.url, {});
  }

  return { getInfo, getStream };
}
