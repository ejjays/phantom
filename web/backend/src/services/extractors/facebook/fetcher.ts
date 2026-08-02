import { HEADERS, DESKTOP_UA } from './constants.js';
import { logger } from '../../../utils/infra/logger.util.js';
import { secureFetch } from '../../../utils/network/security.util.js';

type FetchHtmlOptions = {
  cookie?: string;
};

export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions,
  timeoutMs = 10000
): Promise<{ html: string; targetUrl: string; res: Response } | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const response = await secureFetch(url, {
    headers: {
      ...HEADERS,
      ...(cookie && { Cookie: cookie }),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) return null;
  const targetUrl = response.url;
  const html = await response.text();
  return { html, targetUrl, res: response as unknown as Response };
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
    if (error instanceof Error) {
      logger.debug('[FacebookExtractor] Size fetch error:', error.message);
    } else {
      logger.debug('[FacebookExtractor] Size fetch error:', String(error));
    }
  }
  return undefined;
}
