import { Format, VideoInfo, ExtractorOptions } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { normalizeTitle, normalizeArtist } from './social.js';
import { DESKTOP_UA } from './util.js';

const REFERER = 'https://www.twitch.tv/';
const CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const GQL_URL = 'https://gql.twitch.tv/gql';
const HASH_SHARE_CLIP_RENDER_STATUS = '0a02bb974443b576f5579aab0fef1d4b7f44e58a8a256f0c5adfead0db70640f';

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
    /clip\.twitch\.tv\/(?:embed\?[^#]*\bclip=)?([a-zA-Z0-9_-]+)/u,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
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

function buildProgressiveFormats(assets: TwitchClipAsset[] | undefined, sig?: string, token?: string): Format[] {
  const formats: Format[] = [];
  if (!assets) return formats;
  const seen = new Set<string>();
  for (let ai = 0; ai < assets.length; ai++) {
    const asset = assets[ai];
    const isPortrait = ai > 0;
    for (const vq of asset.videoQualities ?? []) {
      const h = Number(vq.quality);
      if (!Number.isFinite(h)) continue;
      const frameRate = vq.frameRate ? Number(vq.frameRate) : undefined;
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
  const res = await env.fetch(GQL_URL, {
    method: 'POST',
    headers: { 'User-Agent': DESKTOP_UA, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', Referer: REFERER },
    body: JSON.stringify([{ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }]),
  });
  if (!res.ok) return { status: res.status, body: '' };
  return { status: res.status, body: await res.text() };
}

export function createTwitchExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, _opts: ExtractorOptions = {}): Promise<VideoInfo | null> {
    const clipId = parseClipId(url);
    if (!clipId) return null;
    try {
      const gql = await gqlPost(env, 'ShareClipRenderStatus', HASH_SHARE_CLIP_RENDER_STATUS, { slug: clipId });
      let clip: TwitchClip | null = null;
      try {
        if (gql.body) {
          const parsed = JSON.parse(gql.body) as Array<{ data?: { clip?: TwitchClip | null } }>;
          clip = parsed?.[0]?.data?.clip ?? null;
        }
      } catch {
        clip = null;
      }
      if (!clip) return null;
      const token = clip.playbackAccessToken?.value;
      const sig = clip.playbackAccessToken?.signature;
      const formats = buildProgressiveFormats(clip.assets, sig, token);
      if (formats.length === 0) return null;
      const info: VideoInfo = {
        type: 'video',
        id: clip.id ?? clipId,
        title: clip.title ?? 'Twitch Clip',
        uploader: clip.curator?.displayName ?? clip.broadcaster?.displayName ?? 'Twitch',
        webpageUrl: url,
        thumbnail: clip.thumbnailURL ?? clip.assets?.[0]?.thumbnailURL ?? undefined,
        duration: clip.durationSeconds ? Math.round(clip.durationSeconds) : undefined,
        formats,
        extractorKey: 'twitch',
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
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[twitch] ${msg}`);
      return null;
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const sel = videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!sel?.url) throw new Error('No stream URL');
    return env.streamUrl(sel.url, {});
  }

  return { getInfo, getStream };
}
