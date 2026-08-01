import { secureFetch } from '../../../utils/network/security.util.js';
import { randomBytes } from 'node:crypto';
import { ExtractorOptions } from '../../../types/index.js';
import {
  WEB_HEADERS,
  MOBILE_HEADERS,
  EMBED_HEADERS,
  IG_APP_ID,
  DESKTOP_UA,
  LOGGED_OUT_DOC_ID,
  LOGGED_OUT_FRIENDLY,
  SHORTCODE_ALPHABET,
} from './constants.js';

const TIMEOUT_MS = 10000;

// fail fast on 429/503; don't hammer & deepen throttle
export class IgRateLimitError extends Error {
  readonly retryable = true;
}
function isRateLimit(status: number): boolean {
  return status === 429 || status === 503;
}

// shortcode from url; oembed maps to numeric id
export function extractShortcode(url: string): string | null {
  const match = url.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/u);
  return match ? match[1] : null;
}

function withCookie(
  headers: Record<string, string>,
  options: ExtractorOptions
): Record<string, string> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  return cookie ? { ...headers, Cookie: cookie } : headers;
}

async function fetchMediaId(
  shortcode: string,
  options: ExtractorOptions
): Promise<string | null> {
  const oembedUrl = `https://i.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${shortcode}/`;
  const response = await secureFetch(oembedUrl, {
    headers: withCookie(MOBILE_HEADERS, options),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (isRateLimit(response.status)) {
    throw new IgRateLimitError('Instagram rate limited (oembed)');
  }
  if (!response.ok) return null;
  const data = (await response.json()) as { media_id?: string };
  return data?.media_id ?? null;
}

// primary: mobile private api; else scrape bootstrap blob
export async function fetchMobileItem(
  shortcode: string,
  options: ExtractorOptions
): Promise<unknown> {
  const mediaId = await fetchMediaId(shortcode, options);
  if (!mediaId) return null;

  const response = await secureFetch(
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    {
      headers: withCookie(MOBILE_HEADERS, options),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (isRateLimit(response.status)) {
    throw new IgRateLimitError('Instagram rate limited (media/info)');
  }
  if (!response.ok) return null;
  const data = (await response.json()) as { items?: unknown[] };
  return data?.items?.[0] ?? null;
}

function objectFromEntries(
  name: string,
  html: string
): Record<string, unknown> | null {
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

// shortcode -> numeric media pk (base-64 decode); long codes carry 28-char suffix
export function shortcodeToMediaId(shortcode: string): string {
  const code = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
  let pk = 0n;
  for (const char of code) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) return '';
    pk = pk * 64n + BigInt(index);
  }
  return pk.toString();
}

// Set-Cookie -> replayable header (anonymous csrftoken/mid, NOT login cookie) // eslint-disable-line phantom/phantom-comments
function jarFromResponse(
  response: globalThis.Response
): Record<string, string> {
  const jar: Record<string, string> = {};
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

// cache anonymous session (never login cookie); html shell drops stale
interface IgSession {
  lsd: string;
  csrf?: string;
  cookie: string;
  expiry: number;
}
let sessionCache: IgSession | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000;

async function getSession(
  shortcode: string,
  options: ExtractorOptions
): Promise<IgSession> {
  const hasCookie = typeof options.cookie === 'string';
  if (!hasCookie && sessionCache && sessionCache.expiry > Date.now()) {
    return sessionCache;
  }

  const pageResponse = await secureFetch(
    `https://www.instagram.com/p/${shortcode}/`,
    {
      headers: withCookie(EMBED_HEADERS, options),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (isRateLimit(pageResponse.status)) {
    throw new IgRateLimitError('Instagram rate limited (page)');
  }
  if (!pageResponse.ok) {
    throw new Error(`Instagram page returned ${pageResponse.status}`);
  }
  const html = await pageResponse.text();

  const jar = jarFromResponse(pageResponse);
  const lsd =
    (objectFromEntries('LSD', html)?.token as string) ||
    randomBytes(8).toString('base64url');
  const csrf =
    jar.csrftoken ||
    (objectFromEntries('InstagramSecurityConfig', html)?.csrf_token as
      | string
      | undefined);
  const anon = Object.entries(jar)
    .map(([key, val]) => `${key}=${val}`)
    .join('; ');
  const cookie =
    hasCookie && options.cookie
      ? [options.cookie, anon].filter(Boolean).join('; ')
      : anon;

  const session: IgSession = {
    lsd,
    csrf,
    cookie,
    expiry: Date.now() + SESSION_TTL_MS,
  };
  if (!hasCookie) sessionCache = session;
  return session;
}

// IG gates shortcode query; media_id served logged-out, sec-fetch keeps JSON // eslint-disable-line phantom/phantom-comments
export async function fetchLoggedOutMedia(
  shortcode: string,
  options: ExtractorOptions
): Promise<unknown> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return null;

  const { lsd, csrf, cookie } = await getSession(shortcode, options);

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

  const response = await secureFetch('https://www.instagram.com/api/graphql', {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (isRateLimit(response.status)) {
    throw new IgRateLimitError('Instagram rate limited (graphql)');
  }
  if (!response.ok) return null;

  const text = (await response.text()).replace(/^for\s*\(;;\);/u, '');
  if (text.startsWith('<')) {
    sessionCache = null;
    return null;
  }
  try {
    const json = JSON.parse(text) as {
      data?: { xig_polaris_media?: { if_not_gated_logged_out?: unknown } };
    };
    return json?.data?.xig_polaris_media?.if_not_gated_logged_out ?? null;
  } catch {
    return null;
  }
}

// last resort, captioned embed html
export async function fetchEmbedHtml(
  url: string,
  options: ExtractorOptions
): Promise<string | null> {
  const base = url.split('?')[0].replace(/\/?$/u, '/');
  const response = await secureFetch(`${base}embed/captioned/`, {
    headers: withCookie(EMBED_HEADERS, options),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return await response.text();
}

export async function fetchFileSize(url: string): Promise<number | undefined> {
  try {
    const response = await secureFetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': WEB_HEADERS['User-Agent'] },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const len = response.headers.get('content-length');
      if (len) return parseInt(len, 10);
    }
  } catch (error: unknown) {
    console.debug(`[Instagram] Size fetch failed: ${(error as Error).message}`);
  }
  return undefined;
}
