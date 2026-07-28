import { HEADERS, DESKTOP_UA } from './constants.js';
import { secureFetch } from '../../../utils/network/security.util.js';

type FetchOptions = {
  cookie?: string;
};

type FetchResult = { html: string; targetUrl: string };

// public embed endpoint, often ungated
function buildEmbedUrl(url: string): string {
  let clean = url.split('?')[0];
  while (clean.endsWith('/')) clean = clean.slice(0, -1);
  return `${clean}/embed`;
}

async function fetchPage(
  target: string,
  options: FetchOptions
): Promise<FetchResult | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const response = await secureFetch(target, {
    headers: {
      ...HEADERS,
      ...(cookie && { Cookie: cookie }),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  return { html: await response.text(), targetUrl: response.url };
}

export function fetchHtml(
  url: string,
  options: FetchOptions
): Promise<FetchResult | null> {
  return fetchPage(url, options);
}

export function fetchEmbed(
  url: string,
  options: FetchOptions
): Promise<FetchResult | null> {
  return fetchPage(buildEmbedUrl(url), options);
}

export async function fetchFileSize(url: string): Promise<number | undefined> {
  try {
    const headResponse = await secureFetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (headResponse.ok) {
      const contentLength = headResponse.headers.get('content-length');
      if (contentLength) return parseInt(contentLength, 10);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.debug('[ThreadsExtractor] Size fetch error:', message);
  }
  return undefined;
}
