import { Format, VideoInfo, ExtractorOptions } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { normalizeTitle, normalizeArtist } from './social.js';
import { DESKTOP_UA } from './util.js';

const REFERER = 'https://www.snapchat.com/';
const PUBLIC_PAGE = 'https://www.snapchat.com/spotlight/';

interface VideoMetadata {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  contentUrl?: string;
  width?: number;
  height?: number;
  durationMs?: string | number;
  embeddedTextCaption?: string;
  creator?: { personCreator?: { username?: string; name?: string; url?: string } };
}

interface StoryMeta {
  videoMetadata?: VideoMetadata;
  llmTitle?: string;
}
interface StoryEntry {
  story?: { storyId?: { value?: string } };
  metadata?: StoryMeta;
}
interface NextData {
  props?: { pageProps?: { spotlightFeed?: { spotlightStories?: StoryEntry[] } } };
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//iu, '').split(/[/?#]/u)[0].toLowerCase();
}
function isSnapchatHost(url: string): boolean {
  const host = hostOf(url);
  return host === 'snapchat.com' || host === 'www.snapchat.com' || host === 't.snapchat.com' || host === 'story.snapchat.com';
}
export function parseSpotlightId(url: string): string | null {
  const m = url.match(/\/spotlight\/([A-Za-z0-9_-]+)/u);
  return m ? m[1] : null;
}
function nextDataFromHtml(html: string): NextData | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as NextData;
  } catch {
    return null;
  }
}
function findStory(data: NextData, id: string): StoryMeta | null {
  const stories = data.props?.pageProps?.spotlightFeed?.spotlightStories;
  if (!Array.isArray(stories)) return null;
  for (const e of stories) if (e.story?.storyId?.value === id && e.metadata?.videoMetadata?.contentUrl) return e.metadata;
  return null;
}
async function resolveCanonical(env: ExtractorEnv, url: string): Promise<string> {
  try {
    const head = await env.fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': DESKTOP_UA } } as RequestInit);
    if (head.ok || (head as unknown as { status: number }).status < 400) return (head as unknown as { url: string }).url ?? url;
  } catch {
    /* HEAD refused */
  }
  const res = await env.fetch(url, { redirect: 'follow', headers: { 'User-Agent': DESKTOP_UA } } as RequestInit);
  return (res as unknown as { url: string }).url ?? url;
}
function buildFormat(meta: VideoMetadata): Format {
  const w = meta.width && meta.width > 0 ? meta.width : undefined;
  const h = meta.height && meta.height > 0 ? meta.height : undefined;
  const short = h ?? w ?? 0;
  return {
    formatId: short ? `${short}p` : 'source',
    url: meta.contentUrl as string,
    extension: 'mp4',
    resolution: w && h ? `${w}x${h}` : undefined,
    quality: short ? `${short}p` : 'Source',
    width: w,
    height: h,
    vcodec: 'h264',
    acodec: 'aac',
    isVideo: true,
    isAudio: true,
    isMuxed: true,
  };
}

export function createSnapchatExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, _opts: ExtractorOptions = {}): Promise<VideoInfo | null> {
    if (!isSnapchatHost(url)) return null;
    try {
      const isShort = /^https?:\/\/t\.snapchat\.com\//iu.test(url);
      const isProfile = /\/@[A-Za-z0-9._-]+\/spotlight\//u.test(url);
      let target = url;
      if (isShort || isProfile) target = await resolveCanonical(env, url);
      if (!/\/spotlight\//iu.test(target)) return null;
      const id = parseSpotlightId(target);
      if (!id) return null;
      const pageUrl = `${PUBLIC_PAGE}${id}`;
      const res = await env.fetch(pageUrl, { headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER } });
      if (!res.ok) return null;
      const html = await res.text();
      const data = nextDataFromHtml(html);
      if (!data) return null;
      const story = findStory(data, id);
      const meta = story?.videoMetadata;
      if (!meta?.contentUrl) return null;
      const durationMs = typeof meta.durationMs === 'string' ? parseInt(meta.durationMs, 10) : meta.durationMs;
      const duration = durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : undefined;
      const format = buildFormat(meta);
      const creator = meta.creator?.personCreator;
      const displayName = creator?.name ?? creator?.username;
      const info: VideoInfo = {
        type: 'video',
        id,
        title: (story?.llmTitle ?? meta.name ?? meta.embeddedTextCaption ?? meta.description ?? displayName ?? 'Snapchat Spotlight').slice(0, 100),
        uploader: displayName ?? 'Snapchat',
        webpageUrl: pageUrl,
        thumbnail: meta.thumbnailUrl,
        duration,
        formats: [format],
        extractorKey: 'snapchat',
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
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[snapchat] ${msg}`);
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
