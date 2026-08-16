import { HEADERS, DESKTOP_UA } from './constants';
import { gatedFetch, timeoutSignal } from '../../lib/net';
import { probeFileSize } from '../social';

type FetchOptions = {
  cookie?: string;
};

type FetchResult = { html: string; targetUrl: string };

// public embed endpoint, often ungated
function buildEmbedUrl(url: string): string {
  const clean = url.split('?')[0].replace(/\/+$/u, '');
  return `${clean}/embed`;
}

async function fetchPage(
  target: string,
  options: FetchOptions
): Promise<FetchResult | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const response = await gatedFetch(target, {
    headers: {
      ...HEADERS,
      ...(cookie && { Cookie: cookie }),
    },
    redirect: 'follow',
    signal: timeoutSignal(10000),
  });
  if (!response.ok) return null;
  return { html: await response.text(), targetUrl: response.url || target };
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

export function fetchFileSize(url: string): Promise<number | undefined> {
  return probeFileSize(url, { 'User-Agent': DESKTOP_UA });
}
