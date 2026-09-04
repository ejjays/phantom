import {
  fetchPageHtml,
  fetchFileSize,
  type PageFetchOptions,
} from '../shared/utils';

export function fetchHtml(
  url: string,
  options: PageFetchOptions,
  timeoutMs = 10000
): Promise<{ html: string; targetUrl: string } | null> {
  return fetchPageHtml(url, options, timeoutMs);
}

export { fetchFileSize };
