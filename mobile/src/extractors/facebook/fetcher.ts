import { HEADERS, DESKTOP_UA } from './constants';
import { gatedFetch, timeoutSignal } from '../../lib/net';
import { probeFileSize } from '../shared/utils';

type FetchHtmlOptions = {
  cookie?: string;
};

export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions,
  timeoutMs = 10000
): Promise<{ html: string; targetUrl: string } | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const response = await gatedFetch(url, {
    headers: {
      ...HEADERS,
      ...(cookie && { Cookie: cookie }),
    },
    redirect: 'follow',
    signal: timeoutSignal(timeoutMs),
  });

  if (!response.ok) return null;
  const targetUrl = response.url || url;
  const html = await response.text();
  return { html, targetUrl };
}

export function fetchFileSize(url: string): Promise<number | undefined> {
  return probeFileSize(url, { 'User-Agent': DESKTOP_UA });
}
