import { VideoInfo, Format, ExtractorError } from '../types';
import { gatedFetch, mapLimit } from '../../lib/net';
import { getInstagramCookie } from '../../lib/settings';
import { cookieGet } from '../../lib/authFetch';
import { noVideo, fromStatus, classifyThrown } from '../errors';
import { DESKTOP_UA } from '../../lib/userAgents';
import { error as logError } from '../../lib/log';
import { webviewFetch } from './bridge';
import { buildVideoInfo } from '../videoInfo';

function isInstagramHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

const igFetch = (url: string, init?: RequestInit) => {
  if (isInstagramHost(url) && !process.env.VITEST) {
    return webviewFetch(url, init);
  }
  return gatedFetch(url, init);
};

const IG_APP_ID = '936619743392459';
const POST_DOC_ID = '8845758582119845';

// IG gates old shortcode query behind auth now; resolve via /api/graphql with media_id (pk) variant
const LOGGED_OUT_DOC_ID = '27130156389949648';
const LOGGED_OUT_FRIENDLY = 'PolarisLoggedOutDesktopWWWPostRootContentQuery';
const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REFERER = 'https://www.instagram.com/';

const WEB_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  'x-ig-app-id': IG_APP_ID,
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
};
const PAGE_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const MOBILE_UA =
  'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)';
const MOBILE_HEADERS: Record<string, string> = {
  'User-Agent': MOBILE_UA,
  'x-ig-app-id': IG_APP_ID,
  'x-ig-app-locale': 'en_US',
  'x-ig-device-locale': 'en_US',
  'x-ig-mapped-locale': 'en_US',
  'Accept-Language': 'en-US',
  'x-fb-http-engine': 'Liger',
};

interface IgMedia {
  url: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  muxAudioUrl?: string;
  isMuxed?: boolean;
  formatId?: string;
  quality?: string;
}
interface IgParsed {
  id: string | null;
  title: string;
  uploader: string;
  thumbnail?: string;
  media: IgMedia[];
}
interface GqlNode {
  shortcode?: string;
  id?: string;
  video_url?: string;
  display_url?: string;
  dimensions?: { width?: number; height?: number };
  dash_info?: { video_dash_manifest?: string };
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
  owner?: { full_name?: string; username?: string };
  edge_sidecar_to_children?: { edges?: Array<{ node?: GqlNode }> };
}
interface IgVersion {
  url?: string;
  width?: number;
  height?: number;
}
interface IgProduct {
  code?: string;
  pk?: string;
  id?: string;
  caption?: { text?: string };
  user?: { full_name?: string; username?: string };
  image_versions2?: { candidates?: IgVersion[] };
  video_versions?: IgVersion[];
  carousel_media?: IgProduct[];
  video_dash_manifest?: string;
}

function extractShortcode(url: string): string | null {
  const match = url.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/u);
  return match ? match[1] : null;
}

function objFrom(name: string, html: string): Record<string, unknown> | null {
  const match = html.match(
    new RegExp(`\\["${name}",.*?,(\\{.*?\\}),\\d+\\]`, 'u')
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function numQ(name: string, html: string): string | null {
  const match = html.match(new RegExp(`${name}=(\\d+)`, 'u'));
  return match ? match[1] : null;
}

function randomToken(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  );
}

async function fetchGraphqlMedia(shortcode: string): Promise<GqlNode | null> {
  const pageRes = await igFetch(`https://www.instagram.com/p/${shortcode}/`, {
    headers: PAGE_HEADERS,
  });
  if (!pageRes.ok) throw fromStatus(pageRes.status, 'Instagram');
  const html = await pageRes.text();

  const lsd = (objFrom('LSD', html)?.token as string) || randomToken();
  const csrf = objFrom('InstagramSecurityConfig', html)?.csrf_token as
    string | undefined;
  const webConfig = objFrom('DGWWebConfig', html) ?? {};
  const siteData = objFrom('SiteData', html) ?? {};

  const body = new URLSearchParams({
    __d: 'www',
    __a: '1',
    __req: 'b',
    __hs:
      (siteData.haste_session as string) ||
      '20126.HYP:instagram_web_pkg.2.1...0',
    __ccg: 'EXCELLENT',
    __rev: '1019933358',
    dpr: '2',
    __comet_req: numQ('__comet_req', html) || '7',
    lsd,
    jazoest: numQ('jazoest', html) || '2',
    __spin_r: '1019933358',
    __spin_b: 'trunk',
    __spin_t: '1',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
    variables: JSON.stringify({
      shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    server_timestamps: 'true',
    doc_id: POST_DOC_ID,
  });

  const headers: Record<string, string> = {
    ...WEB_HEADERS,
    'x-ig-app-id': (webConfig.appId as string) || IG_APP_ID,
    'X-FB-LSD': lsd,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
  };
  if (csrf) headers['X-CSRFToken'] = csrf;

  const res = await igFetch('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!res.ok) throw fromStatus(res.status, 'Instagram');
  const json = (await res.json()) as {
    data?: { xdt_shortcode_media?: GqlNode; shortcode_media?: GqlNode };
  };
  return json?.data?.xdt_shortcode_media ?? json?.data?.shortcode_media ?? null;
}

// shortcode to numeric media pk; long codes carry 28-char suffix
function shortcodeToMediaId(shortcode: string): string {
  const code = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
  let pk = 0n;
  for (const char of code) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) return '';
    pk = pk * 64n + BigInt(index);
  }
  return pk.toString();
}

// session tokens (lsd/csrf/cookie) cached & replayed by RN store; read-miss harmless
function cookieJar(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  const getter = (res.headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie;
  const many = typeof getter === 'function' ? getter.call(res.headers) : [];
  const single = res.headers.get('set-cookie');
  const list =
    many.length > 0 ? many : single ? single.split(/,(?=[^;]+=)/u) : [];
  for (const entry of list) {
    const [pair] = entry.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

interface IgSession {
  lsd: string;
  csrf?: string;
  cookie: string;
  expiry: number;
}
let sessionCache: IgSession | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000;

async function getSession(shortcode: string): Promise<IgSession> {
  if (sessionCache && sessionCache.expiry > Date.now()) return sessionCache;

  const pageRes = await igFetch(`https://www.instagram.com/p/${shortcode}/`, {
    headers: PAGE_HEADERS,
  });
  if (!pageRes.ok) throw fromStatus(pageRes.status, 'Instagram');
  const html = await pageRes.text();

  const jar = cookieJar(pageRes);
  const lsd = (objFrom('LSD', html)?.token as string) || randomToken();
  const csrf =
    jar.csrftoken ||
    (objFrom('InstagramSecurityConfig', html)?.csrf_token as
      string | undefined);
  const cookie = Object.entries(jar)
    .map(([key, val]) => `${key}=${val}`)
    .join('; ');

  sessionCache = { lsd, csrf, cookie, expiry: Date.now() + SESSION_TTL_MS };
  return sessionCache;
}

// logged-out resolve: reuse cached page tokens, then /api/graphql. sec-fetch headers force JSON response.
async function fetchLoggedOutMedia(
  shortcode: string
): Promise<IgProduct | null> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return null;

  const { lsd, csrf, cookie } = await getSession(shortcode);

  const body = new URLSearchParams({
    av: '0',
    __d: 'www',
    __user: '0',
    dpr: '1',
    lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: LOGGED_OUT_FRIENDLY,
    server_timestamps: 'true',
    variables: JSON.stringify({ media_id: mediaId }),
    doc_id: LOGGED_OUT_DOC_ID,
  });

  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    'X-IG-App-ID': IG_APP_ID,
    'X-ASBD-ID': '359341',
    'X-IG-WWW-Claim': '0',
    'X-FB-Friendly-Name': LOGGED_OUT_FRIENDLY,
    'X-FB-LSD': lsd,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://www.instagram.com',
    Referer: `https://www.instagram.com/p/${shortcode}/`,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };
  if (csrf) headers['X-CSRFToken'] = csrf;
  if (cookie) headers.Cookie = cookie;

  const res = await igFetch('https://www.instagram.com/api/graphql', {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!res.ok) throw fromStatus(res.status, 'Instagram');

  const text = (await res.text()).replace(/^for\s*\(;;\);/u, '');
  if (text.startsWith('<')) {
    // html shell instead of JSON; drop cached tokens as they might be stale
    sessionCache = null;
    return null;
  }
  try {
    const json = JSON.parse(text) as {
      data?: { xig_polaris_media?: { if_not_gated_logged_out?: IgProduct } };
    };
    return json?.data?.xig_polaris_media?.if_not_gated_logged_out ?? null;
  } catch {
    return null;
  }
}

// authenticated private API: preferred when cookie set for higher rate limits
async function fetchMobileItem(
  shortcode: string,
  cookie: string
): Promise<IgProduct | null> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return null;

  const res = await cookieGet(
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    { ...MOBILE_HEADERS, Cookie: cookie }
  );
  // 403 falls back to logged-out; 429 fails fast (retryable)
  if (!res.ok) throw fromStatus(res.status, 'Instagram');
  const data = (await res.json()) as { items?: IgProduct[] };
  return data?.items?.[0] ?? null;
}

function mediaFromGql(node: GqlNode | undefined): IgMedia | null {
  if (!node) return null;
  if (node.video_url) {
    return {
      url: node.video_url,
      isVideo: true,
      width: node.dimensions?.width,
      height: node.dimensions?.height,
    };
  }
  if (node.display_url) {
    return {
      url: node.display_url,
      isVideo: false,
      width: node.dimensions?.width,
      height: node.dimensions?.height,
    };
  }
  return null;
}

interface DashVideo {
  url: string;
  width: number;
  height: number;
}

export function parseDashManifest(manifest: string): {
  videos: DashVideo[];
  audioUrl?: string;
} {
  const videos: DashVideo[] = [];
  let audioUrl: string | undefined;
  let bestAudioBw = -1;
  for (const rep of manifest.matchAll(
    /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gu
  )) {
    const attrs = rep[1];
    const baseMatch = rep[2].match(/<BaseURL>([^<]+)<\/BaseURL>/u);
    if (!baseMatch) continue;
    const url = baseMatch[1].trim().replace(/&amp;/gu, '&');
    const width = Number(attrs.match(/\bwidth="(\d+)"/u)?.[1] ?? 0);
    const height = Number(attrs.match(/\bheight="(\d+)"/u)?.[1] ?? 0);
    const isAudio = /mimeType="audio/u.test(attrs) || (!width && !height);
    if (isAudio) {
      const bandwidth = Number(attrs.match(/\bbandwidth="(\d+)"/u)?.[1] ?? 0);
      if (bandwidth > bestAudioBw) {
        bestAudioBw = bandwidth;
        audioUrl = url;
      }
    } else if (width && height) {
      videos.push({ url, width, height });
    }
  }
  const seen = new Set<string>();
  const deduped = videos.filter((video) => {
    const key = `${video.width}x${video.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { videos: deduped, audioUrl };
}

function expandDashVariants(base: IgMedia, manifest?: string): IgMedia[] {
  if (!base.isVideo) return [base];
  const dash = manifest ? parseDashManifest(manifest) : null;
  if (!dash || dash.videos.length === 0 || !dash.audioUrl) return [base];

  const list: IgMedia[] = dash.videos.map((video) => {
    const short = Math.min(video.width, video.height);
    return {
      url: video.url,
      isVideo: true,
      width: video.width,
      height: video.height,
      muxAudioUrl: dash.audioUrl,
      isMuxed: false,
      formatId: `${short}p`,
      quality: `${short}p`,
    };
  });
  const pShort =
    base.width && base.height ? Math.min(base.width, base.height) : 0;
  list.push({
    ...base,
    isMuxed: true,
    formatId: pShort ? `${pShort}p_progressive` : 'sd',
    quality: pShort ? `${pShort}p` : 'SD',
  });
  list.sort(
    (lhs, rhs) =>
      (rhs.width ?? 0) * (rhs.height ?? 0) -
      (lhs.width ?? 0) * (lhs.height ?? 0)
  );
  const seen = new Set<string>();
  return list.filter((entry) => {
    const key = entry.formatId as string;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function singleVideoMedia(node: GqlNode): IgMedia[] {
  const base = mediaFromGql(node);
  if (!base) return [];
  return expandDashVariants(base, node.dash_info?.video_dash_manifest);
}

function parseGraphqlMedia(node: GqlNode | null): IgParsed | null {
  if (!node) return null;
  const sidecar = node.edge_sidecar_to_children?.edges;
  const media: IgMedia[] = Array.isArray(sidecar)
    ? (sidecar
        .map((edge) => mediaFromGql(edge?.node))
        .filter(Boolean) as IgMedia[])
    : singleVideoMedia(node);
  if (media.length === 0) return null;
  return {
    id: node.shortcode || node.id || null,
    title:
      node.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Post',
    uploader: node.owner?.full_name || node.owner?.username || 'Instagram User',
    thumbnail: node.display_url,
    media,
  };
}

function mediaFromVersions(node: IgProduct): IgMedia | null {
  const videos = node.video_versions;
  if (Array.isArray(videos) && videos.length > 0) {
    const best = videos.reduce((prev, next) =>
      (prev.width ?? 0) * (prev.height ?? 0) <
      (next.width ?? 0) * (next.height ?? 0)
        ? next
        : prev
    );
    if (best.url) {
      return {
        url: best.url,
        isVideo: true,
        width: best.width,
        height: best.height,
      };
    }
  }
  const candidate = node.image_versions2?.candidates?.[0];
  if (candidate?.url) {
    return {
      url: candidate.url,
      isVideo: false,
      width: candidate.width,
      height: candidate.height,
    };
  }
  return null;
}

function parseLoggedOutProduct(product: IgProduct | null): IgParsed | null {
  if (!product) return null;
  const carousel = product.carousel_media;
  let media: IgMedia[];
  if (Array.isArray(carousel)) {
    media = carousel.map(mediaFromVersions).filter(Boolean) as IgMedia[];
  } else {
    const base = mediaFromVersions(product);
    media = base ? expandDashVariants(base, product.video_dash_manifest) : [];
  }
  if (media.length === 0) return null;
  return {
    id: product.code || product.pk || product.id || null,
    title: product.caption?.text || 'Instagram Post',
    uploader:
      product.user?.full_name || product.user?.username || 'Instagram User',
    thumbnail: product.image_versions2?.candidates?.[0]?.url,
    media,
  };
}

function toFormat(media: IgMedia, index: number, total: number): Format {
  const dims =
    media.width && media.height ? `${media.width}x${media.height}` : undefined;
  const prefix = total > 1 ? `item${index + 1}_` : '';

  if (media.isVideo) {
    const muxed = media.isMuxed !== false;
    return {
      formatId: media.formatId ?? `${prefix}hd`,
      url: media.url,
      extension: 'mp4',
      resolution: dims ?? 'Source',
      quality: media.quality ?? (total > 1 ? `Item ${index + 1}` : 'HD'),
      width: media.width,
      height: media.height,
      vcodec: 'h264',
      acodec: 'aac',
      isVideo: true,
      isAudio: false,
      isMuxed: muxed,
      muxAudioUrl: muxed ? undefined : media.muxAudioUrl,
      muxAudioExt: muxed ? undefined : 'm4a',
    };
  }

  return {
    formatId: media.formatId ?? `${prefix}photo`,
    url: media.url,
    extension: 'jpg',
    resolution: dims ?? 'Photo',
    quality: media.quality ?? (total > 1 ? `Item ${index + 1}` : 'Photo'),
    width: media.width,
    height: media.height,
    vcodec: 'none',
    acodec: 'none',
    isVideo: false,
    isAudio: false,
    isMuxed: false,
  };
}

async function fetchSize(url: string): Promise<number | undefined> {
  try {
    const res = await igFetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Referer: REFERER,
        Range: 'bytes=0-0',
      },
    });
    const range = res.headers.get('content-range');
    const match = range ? /\/(\d+)\s*$/u.exec(range) : null;
    if (match) return parseInt(match[1], 10);
    const len = res.headers.get('content-length');
    return len ? parseInt(len, 10) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveParsed(shortcode: string): Promise<IgParsed> {
  const cookie = getInstagramCookie();
  const resolvers: Array<() => Promise<IgParsed | null>> = [];
  if (cookie) {
    resolvers.push(async () =>
      parseLoggedOutProduct(await fetchMobileItem(shortcode, cookie))
    );
  }
  resolvers.push(async () =>
    parseLoggedOutProduct(await fetchLoggedOutMedia(shortcode))
  );
  resolvers.push(async () =>
    parseGraphqlMedia(await fetchGraphqlMedia(shortcode))
  );

  let lastError: unknown = null;
  for (const resolve of resolvers) {
    try {
      const parsed = await resolve();
      if (parsed && parsed.media.length > 0) return parsed;
    } catch (error: unknown) {
      lastError = error;
      // rate-limited; stop loop to prevent deeper throttle
      if (error instanceof ExtractorError && error.retryable) throw error;
    }
  }
  if (lastError) throw lastError;
  throw noVideo('Instagram');
}

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const shortcode = extractShortcode(url);
    if (!shortcode) return null;

    const parsed = await resolveParsed(shortcode);

    const total = parsed.media.length;
    const formats = parsed.media.map((media, index) =>
      toFormat(media, index, total)
    );

    await mapLimit(formats, 2, async (format) => {
      if (format.filesize) return;
      const size = await fetchSize(format.url);
      if (size) format.filesize = size;
    });

    const info: VideoInfo = buildVideoInfo({
      id: parsed.id || url,
      title: parsed.title || 'Instagram Video',
      uploader: parsed.uploader || 'Instagram User',
      webpageUrl: url,
      thumbnail: parsed.thumbnail,
      formats,
      extractorKey: 'instagram',
      downloadHeaders: {
        'User-Agent': DESKTOP_UA,
        Referer: REFERER,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Range: 'bytes=0-',
      },
    });

    return info;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('instagram', `[JS-IG] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'Instagram');
  }
}
