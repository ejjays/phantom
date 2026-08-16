import { VideoInfo, Format } from './shared/types';
import { gatedFetch, mapLimit } from '../lib/net';
import { noVideo, notFound, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError, log, warn as logWarn } from '../lib/log';
import { OnPartial } from '../extractors/index';
import { buildVideoInfo } from './shared/videoInfo';
import { probeFileSize } from './shared/utils';

const REFERER = 'https://www.twitch.tv/';
const TW_DEBUG = false;

// web public client ID for anon ShareClipRenderStatus; legacy ID 400s
const CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const GQL_URL = 'https://gql.twitch.tv/gql';

// persisted-query hashes (resolves operation server-side — no inline body needed).
const HASH_SHARE_CLIP_RENDER_STATUS =
  '0a02bb974443b576f5579aab0fef1d4b7f44e58a8a256f0c5adfead0db70640f';
const HASH_VIDEO_METADATA =
  '45111672eea2e507f8ba44d101a61862f9c56b11dee09a15634cb75cb9b9084d';

function twlog(...args: unknown[]): void {
  if (TW_DEBUG) log('twitch', '[JS-Twitch]', ...args);
}

interface TwitchClipAsset {
  aspectRatio?: number | null;
  thumbnailURL?: string | null;
  videoQualities?: Array<{
    quality: string;
    frameRate?: number | null;
    sourceURL: string;
  }>;
}

interface TwitchClip {
  id?: string;
  title?: string;
  durationSeconds?: number | null;
  viewCount?: number | null;
  createdAt?: string | null;
  thumbnailURL?: string | null;
  playbackAccessToken?: { signature?: string; value?: string } | null;
  assets?: TwitchClipAsset[];
  broadcaster?: { id?: string; displayName?: string };
  curator?: { id?: string; displayName?: string };
  game?: { displayName?: string };
}

interface TwitchVodMetadata {
  id?: string;
  title?: string;
  description?: string;
  lengthSeconds?: number;
  previewThumbnailURL?: string | null;
  owner?: { displayName?: string; login?: string };
  viewCount?: number;
  publishedAt?: string;
  moments?: Array<{
    node: {
      positionMilliseconds?: number;
      durationMilliseconds?: number;
      description?: string;
    };
  }>;
  seekPreviewsURL?: string | null;
}

interface GqlResult {
  status: number;
  body: string;
}

function parseClipId(url: string): string | null {
  const patterns = [
    /twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/u,
    /twitch\.tv\/clip\/([a-zA-Z0-9_-]+)/u,
    /clip\.twitch\.tv\/(?:embed\?.*?\bclip=)?([a-zA-Z0-9_-]+)/u,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseVodId(url: string): string | null {
  const match = url.match(/twitch\.tv\/(?:[^/]+\/)?v(?:ideos?)?\/(\d+)/u);
  return match ? match[1] : null;
}

// GQL-signed clips: append playbackAccessToken sig+token to MP4 or CDN 403s
function signClipUrl(
  sourceUrl: string,
  signature?: string,
  token?: string
): string {
  if (!signature || !token) return sourceUrl;
  try {
    const signed = new URL(sourceUrl);
    signed.searchParams.set('sig', signature);
    signed.searchParams.set('token', token);
    return signed.toString();
  } catch {
    const sep = sourceUrl.includes('?') ? '&' : '?';
    return `${sourceUrl}${sep}sig=${encodeURIComponent(signature)}&token=${encodeURIComponent(token)}`;
  }
}

function parseIntSafe(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num)
    ? Math.round(num)
    : undefined;
}

function parseFloatSafe(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
}

function buildProgressiveFormats(
  assets: TwitchClipAsset[] | undefined,
  signature: string | undefined,
  token: string | undefined
): Format[] {
  const formats: Format[] = [];
  if (!assets) return formats;

  const seen = new Set<string>();
  for (let ai = 0; ai < assets.length; ai += 1) {
    const asset = assets[ai];
    const isPortrait = ai > 0;
    for (const vq of asset.videoQualities ?? []) {
      const height = parseIntSafe(vq.quality);
      const frameRate = parseFloatSafe(vq.frameRate);
      const formatId = isPortrait ? `portrait-${vq.quality}` : vq.quality;
      if (seen.has(formatId)) continue;
      seen.add(formatId);

      formats.push({
        formatId,
        url: signClipUrl(vq.sourceURL, signature, token),
        extension: 'mp4',
        quality:
          `${vq.quality}p${frameRate && frameRate >= 59 ? Math.round(frameRate) : ''}`.trim(),
        width:
          height && asset.aspectRatio
            ? Math.round(height * asset.aspectRatio)
            : undefined,
        height,
        vcodec: 'h264',
        acodec: 'aac',
        isVideo: true,
        isAudio: false,
        isMuxed: true,
      });
    }
  }

  formats.sort((cur, other) => {
    const curPortrait = cur.formatId.startsWith('portrait') ? 1 : 0;
    const otherPortrait = other.formatId.startsWith('portrait') ? 1 : 0;
    if (curPortrait !== otherPortrait) return curPortrait - otherPortrait;
    return (other.height ?? 0) - (cur.height ?? 0);
  });
  return formats;
}

async function gqlPost(
  operationName: string,
  hash: string,
  variables: Record<string, unknown>
): Promise<GqlResult> {
  const res = await gatedFetch(GQL_URL, {
    method: 'POST',
    headers: {
      'User-Agent': DESKTOP_UA,
      'Client-ID': CLIENT_ID,
      'Content-Type': 'application/json',
      Referer: REFERER,
    },
    body: JSON.stringify([
      {
        operationName,
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      },
    ]),
  });
  twlog('gql', operationName, 'status', res.status);
  if (!res.ok) {
    logWarn('twitch', `[JS-Twitch] GQL ${operationName} HTTP ${res.status}`);
    return { status: res.status, body: '' };
  }
  return { status: res.status, body: await res.text() };
}

// inline GQL: raw query string — no persisted hash. Used for videoPlaybackAccessToken.
async function gqlInline(query: string): Promise<GqlResult> {
  const res = await gatedFetch(GQL_URL, {
    method: 'POST',
    headers: {
      'User-Agent': DESKTOP_UA,
      'Client-ID': CLIENT_ID,
      'Content-Type': 'text/plain;charset=UTF-8',
      Referer: REFERER,
    },
    body: JSON.stringify([{ query }]),
  });
  twlog('gql-inline', 'status', res.status);
  if (!res.ok) {
    logWarn('twitch', `[JS-Twitch] GQL inline HTTP ${res.status}`);
    return { status: res.status, body: '' };
  }
  return { status: res.status, body: await res.text() };
}

async function fetchClipViaGql(slug: string): Promise<GqlResult> {
  try {
    return await gqlPost(
      'ShareClipRenderStatus',
      HASH_SHARE_CLIP_RENDER_STATUS,
      { slug }
    );
  } catch (e) {
    twlog('gql error', String(e));
    return { status: 0, body: '' };
  }
}

async function fetchVodMetadata(vodId: string): Promise<GqlResult> {
  return await gqlPost('VideoMetadata', HASH_VIDEO_METADATA, {
    videoID: vodId,
    channelLogin: '',
  });
}

async function fetchVodAccessToken(vodId: string): Promise<GqlResult> {
  try {
    return await gqlInline(`
      {
        videoPlaybackAccessToken(
          id: "${vodId}",
          params: {
            platform: "web",
            playerBackend: "mediaplayer",
            playerType: "site"
          }
        )
        {
          value
          signature
        }
      }
    `);
  } catch (e) {
    twlog('gql-inline error', String(e));
    return { status: 0, body: '' };
  }
}

// Twitch VOD master: EXT-X-MEDIA:VIDEO structure differs from std hls
async function parseHlsMaster(
  masterUrl: string,
  durationSec: number | undefined
): Promise<Format[]> {
  let text: string;
  try {
    const res = await gatedFetch(masterUrl, {
      headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
    });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const formats: Format[] = [];
  const seenHeights = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const attrs = line;
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith('#')) continue;

    const dims = attrs.match(/RESOLUTION=(\d+)x(\d+)/u);
    if (!dims) continue;

    const width = Number(dims[1]);
    const height = Number(dims[2]);
    if (seenHeights.has(height)) continue;
    seenHeights.add(height);

    const bandwidth = Number(
      attrs.match(/AVERAGE-BANDWIDTH=(\d+)/u)?.[1] ??
        attrs.match(/BANDWIDTH=(\d+)/u)?.[1] ??
        0
    );
    const frameRate = parseFloat(
      attrs.match(/FRAME-RATE=([\d.]+)/u)?.[1] ?? '0'
    );
    const codecs = attrs.match(/CODECS="([^"]+)"/u)?.[1] ?? '';

    let vcodec: string | undefined = 'h264';
    if (/av01/u.test(codecs)) vcodec = 'av1';
    else if (/hvc1|hev1/u.test(codecs)) vcodec = 'hevc';

    formats.push({
      formatId:
        `${height}p${frameRate >= 59 ? Math.round(frameRate) : ''}`.trim(),
      url: new URL(uri, masterUrl).toString(),
      extension: 'mp4',
      resolution: `${width}x${height}`,
      quality:
        `${height}p${frameRate >= 59 ? Math.round(frameRate) : ''}`.trim(),
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
      filesize:
        bandwidth > 0 && typeof durationSec === 'number' && durationSec > 0
          ? Math.round((bandwidth / 8) * durationSec)
          : undefined,
    });
  }

  formats.sort((cur, other) => (other.height ?? 0) - (cur.height ?? 0));
  return formats;
}

async function extractClip(
  slug: string,
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  const gql = await fetchClipViaGql(slug);

  let clip: TwitchClip | null = null;
  try {
    if (gql.body) {
      const parsed = JSON.parse(gql.body) as Array<{
        data?: { clip?: TwitchClip | null };
      }>;
      clip = parsed?.[0]?.data?.clip ?? null;
    }
  } catch {
    clip = null;
  }

  if (!clip) {
    if (gql.status === 200) throw notFound('Twitch', 'clip');
    throw noVideo('Twitch', 'clip');
  }

  const token = clip.playbackAccessToken?.value;
  const signature = clip.playbackAccessToken?.signature;
  const formats = buildProgressiveFormats(clip.assets, signature, token);
  if (formats.length === 0) throw noVideo('Twitch', 'clip');

  const uploader =
    clip.curator?.displayName || clip.broadcaster?.displayName || 'Twitch';
  const thumb =
    clip.thumbnailURL ?? clip.assets?.[0]?.thumbnailURL ?? undefined;

  const info = buildVideoInfo({
    id: clip.id || slug,
    title: clip.title || 'Twitch Clip',
    uploader,
    webpageUrl: url,
    thumbnail: thumb,
    formats,
    duration: parseIntSafe(clip.durationSeconds),
    extractorKey: 'twitch',
  });

  // emit result early for faster UI feedback
  onPartial?.(info);

  await mapLimit(formats, 3, async (format) => {
    const size = await probeFileSize(format.url, {
      'User-Agent': DESKTOP_UA,
      Referer: REFERER,
    });
    if (size) format.filesize = size;
  });

  onPartial?.(info);
  return info;
}

async function extractVod(
  vodId: string,
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  const metaGql = await fetchVodMetadata(vodId);
  let vodMeta: TwitchVodMetadata | null = null;
  try {
    if (metaGql.body) {
      const parsed = JSON.parse(metaGql.body) as Array<{
        data?: { video?: TwitchVodMetadata | null };
      }>;
      vodMeta = parsed?.[0]?.data?.video ?? null;
    }
  } catch {
    vodMeta = null;
  }

  if (!vodMeta) {
    if (metaGql.status === 200) throw notFound('Twitch', 'VOD');
    throw noVideo('Twitch', 'VOD');
  }

  const title = vodMeta.title ?? 'Twitch VOD';
  const uploader = vodMeta.owner?.displayName ?? 'Twitch';
  const thumb = vodMeta.previewThumbnailURL ?? undefined;
  const duration = parseIntSafe(vodMeta.lengthSeconds);

  onPartial?.(
    buildVideoInfo({
      id: vodMeta.id ?? vodId,
      title,
      uploader,
      webpageUrl: url,
      thumbnail: thumb,
      duration,
      formats: [],
      extractorKey: 'twitch',
      isPartial: true,
    })
  );

  const tokenGql = await fetchVodAccessToken(vodId);
  let tokenValue: string | undefined;
  let tokenSignature: string | undefined;
  try {
    if (tokenGql.body) {
      const parsed = JSON.parse(tokenGql.body) as Array<{
        data?: {
          videoPlaybackAccessToken?: {
            value?: string;
            signature?: string;
          } | null;
        };
      }>;
      const tokenData = parsed?.[0]?.data?.videoPlaybackAccessToken ?? null;
      tokenValue = tokenData?.value;
      tokenSignature = tokenData?.signature;
    }
  } catch {
    tokenValue = undefined;
    tokenSignature = undefined;
  }

  if (!tokenValue || !tokenSignature) {
    throw noVideo('Twitch', 'VOD');
  }

  const usherUrl = new URL(`https://usher.ttvnw.net/vod/${vodId}.m3u8`);
  usherUrl.searchParams.set('allow_source', 'true');
  usherUrl.searchParams.set('allow_audio_only', 'true');
  usherUrl.searchParams.set('p', String(Math.floor(Math.random() * 10000000)));
  usherUrl.searchParams.set('platform', 'web');
  usherUrl.searchParams.set('player', 'twitchweb');
  usherUrl.searchParams.set('sig', tokenSignature);
  usherUrl.searchParams.set('token', tokenValue);

  const formats = await parseHlsMaster(usherUrl.toString(), duration);
  if (formats.length === 0) throw noVideo('Twitch', 'VOD');

  const finalInfo = buildVideoInfo({
    id: vodMeta.id ?? vodId,
    title,
    uploader,
    webpageUrl: url,
    thumbnail: thumb,
    duration,
    formats,
    extractorKey: 'twitch',
  });

  onPartial?.(finalInfo);
  return finalInfo;
}

export async function getInfo(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  try {
    const clipId = parseClipId(url);
    const vodId = parseVodId(url);

    if (!clipId && !vodId) {
      logWarn('twitch', `[JS-Twitch] no vod/clip id found: ${url}`);
      throw noVideo('Twitch');
    }

    if (clipId) return await extractClip(clipId, url, onPartial);
    return await extractVod(vodId as string, url, onPartial);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('twitch', `[JS-Twitch] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Twitch');
  }
}
