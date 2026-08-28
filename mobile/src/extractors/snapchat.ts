import { VideoInfo, Format } from './shared/types';
import { gatedFetch } from '../lib/net';
import { noVideo, notFound, fromStatus, classifyThrown } from './shared/errors';
import { DESKTOP_UA } from '../lib/userAgents';
import { error as logError } from '../lib/log';
import { buildVideoInfo } from './shared/videoInfo';
import { probeFileSize } from './shared/utils';

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
  creator?: {
    $case?: string;
    personCreator?: {
      username?: string;
      name?: string;
      url?: string;
    };
  };
}

interface StoryMeta {
  videoMetadata?: VideoMetadata;
  llmTitle?: string;
  llmDescription?: string;
}
interface StoryEntry {
  story?: { storyId?: { value?: string } };
  metadata?: StoryMeta;
}
interface NextData {
  props?: {
    pageProps?: {
      spotlightFeed?: { spotlightStories?: StoryEntry[] };
    };
  };
}

function hostOf(url: string): string {
  return url
    .replace(/^https?:\/\//iu, '')
    .split(/[/?#]/u)[0]
    .toLowerCase();
}

function isSnapchatHost(url: string): boolean {
  const host = hostOf(url);
  if (host === 'snapchat.com' || host === 'www.snapchat.com') return true;
  if (host === 't.snapchat.com') return true;
  if (host === 'story.snapchat.com') return true;
  return false;
}

// spotlight id = base64url token at /spotlight/<id> (same for /@user/spotlight & t.snapchat.com short)
export function parseSpotlightId(url: string): string | null {
  const match = url.match(/\/spotlight\/([A-Za-z0-9_-]+)/u);
  return match ? match[1] : null;
}

function nextDataFromHtml(html: string): NextData | null {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as NextData;
  } catch {
    return null;
  }
}

function findStory(data: NextData, id: string): StoryMeta | null {
  const stories = data.props?.pageProps?.spotlightFeed?.spotlightStories;
  if (!Array.isArray(stories)) return null;
  for (const entry of stories) {
    if (entry?.story?.storyId?.value !== id) continue;
    if (entry.metadata?.videoMetadata?.contentUrl) return entry.metadata;
  }
  return null;
}

// follow short link / profile url → /spotlight/<id> canonical form
async function resolveCanonical(url: string): Promise<string> {
  try {
    const head = await gatedFetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (head.ok || head.status < 400) return head.url || url;
  } catch {
    // head refused → try GET
  }
  const res = await gatedFetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': DESKTOP_UA },
  });
  return res.url || url;
}

function buildFormat(meta: VideoMetadata): Format {
  const width = meta.width && meta.width > 0 ? meta.width : undefined;
  const height = meta.height && meta.height > 0 ? meta.height : undefined;
  const short = height ?? width ?? 0;
  return {
    formatId: short ? `${short}p` : 'source',
    url: meta.contentUrl as string,
    extension: 'mp4',
    resolution: width && height ? `${width}x${height}` : undefined,
    quality: short ? `${short}p` : 'Source',
    width,
    height,
    vcodec: 'h264',
    acodec: 'aac',
    isVideo: true,
    isAudio: true,
    isMuxed: true,
  };
}

interface Creator {
  username?: string;
  displayName?: string;
  url?: string;
}

function creatorFrom(meta: VideoMetadata): Creator {
  const pc = meta.creator?.personCreator;
  if (!pc) return {};
  return {
    username: pc.username,
    displayName: pc.name,
    url: pc.url,
  };
}

// spotlight pages for platform accounts ship creator: null; the handle
// survives only in the og:url canonical (@user/spotlight/<id>)
function handleFromOgUrl(html: string): string | undefined {
  const tag = html.match(/<meta[^>]+property=["']og:url["'][^>]*>/iu);
  const content = tag?.[0].match(/content=["']([^"']+)["']/iu)?.[1];
  return content?.match(/\/@([A-Za-z0-9._-]+)\/spotlight\//iu)?.[1];
}

// snap fills every clip w/ these placeholders; treat as missing
const GENERIC_NAMES = new Set([
  'spotlight snap',
  'spotlight',
  'another spotlight snap brought to you by snapchat',
]);

function trimTitle(text: string): string {
  if (text.length <= 100) return text;
  const cut = text.slice(0, 100);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60))}…`;
}

function cleanRaw(raw: string | undefined): string {
  return (raw || '').replace(/\s+/gu, ' ').trim();
}

function isGeneric(text: string): boolean {
  return GENERIC_NAMES.has(text.toLowerCase());
}

// hashtag-only strings like "#viral #fyp" make bad titles
function hasNonHashtagWord(text: string): boolean {
  const stripped = text.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  return /\S/u.test(stripped);
}

function pickTitle(
  video: VideoMetadata | undefined,
  story: StoryMeta | undefined,
  creator: Creator
): string {
  // snap's ai-generated title wins (even when creator typed nothing)
  const llm = cleanRaw(story?.llmTitle);
  if (llm) return trimTitle(llm);

  const name = cleanRaw(video?.name);
  if (name && !isGeneric(name)) return trimTitle(name);

  const caption = cleanRaw(video?.embeddedTextCaption);
  if (caption && !isGeneric(caption) && hasNonHashtagWord(caption)) {
    return trimTitle(caption);
  }

  const description = cleanRaw(video?.description);
  if (
    description &&
    !isGeneric(description) &&
    hasNonHashtagWord(description)
  ) {
    return trimTitle(description);
  }

  return creator.displayName || creator.username || 'Snapchat Spotlight';
}

function pickUploader(creator: Creator): string {
  return creator.displayName || creator.username || 'Snapchat';
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  if (!isSnapchatHost(url)) return null;

  try {
    const isShort = /^https?:\/\/t\.snapchat\.com\//iu.test(url);
    const isProfile = /\/@[A-Za-z0-9._-]+\/spotlight\//u.test(url);
    let target = url;
    if (isShort || isProfile) target = await resolveCanonical(url);

    // t.snapchat.com short links can land on story.snapchat.com (snaps/stories)
    // — refuse those, only spotlight pages are ours
    if (!/\/spotlight\//iu.test(target)) {
      if (isShort) throw notFound('Snapchat', 'spotlight');
      return null;
    }

    const id = parseSpotlightId(target);
    if (!id) {
      if (isShort) throw notFound('Snapchat', 'spotlight');
      return null;
    }

    const pageUrl = `${PUBLIC_PAGE}${id}`;
    const res = await gatedFetch(pageUrl, {
      headers: { 'User-Agent': DESKTOP_UA, Referer: REFERER },
    });
    if (!res.ok) throw fromStatus(res.status, 'Snapchat', 'spotlight');

    const html = await res.text();
    const data = nextDataFromHtml(html);
    if (!data) throw noVideo('Snapchat', 'spotlight');

    const story = findStory(data, id);
    const meta = story?.videoMetadata;
    if (!meta?.contentUrl) throw noVideo('Snapchat', 'spotlight');

    const durationMs =
      typeof meta.durationMs === 'string'
        ? parseInt(meta.durationMs, 10)
        : meta.durationMs;
    const duration =
      durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : undefined;

    const format = buildFormat(meta);
    const downloadHeaders = { 'User-Agent': DESKTOP_UA, Referer: REFERER };
    // cdn often ignores HEAD/Range; picker just shows no size if so
    const probed = await probeFileSize(meta.contentUrl, downloadHeaders);
    if (probed) format.filesize = probed;

    const creator = creatorFrom(meta);
    if (!creator.username && !creator.displayName) {
      creator.username = handleFromOgUrl(html);
    }

    return buildVideoInfo({
      id,
      title: pickTitle(meta, story ?? undefined, creator),
      uploader: pickUploader(creator),
      webpageUrl: pageUrl,
      thumbnail: meta.thumbnailUrl,
      duration,
      formats: [format],
      extractorKey: 'snapchat',
      downloadHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('snapchat', `[JS-Snapchat] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Snapchat', 'spotlight');
  }
}
