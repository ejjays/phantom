import {
  fetchPageHtml,
  fetchFileSize,
  type PageFetchOptions,
  type PageFetchResult,
} from '../shared/utils';

export function fetchHtml(
  url: string,
  options: PageFetchOptions,
  timeoutMs = 10000
): Promise<PageFetchResult | null> {
  return fetchPageHtml(url, options, timeoutMs);
}

export { fetchFileSize };
