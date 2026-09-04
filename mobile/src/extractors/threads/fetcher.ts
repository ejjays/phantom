import {
  fetchPageHtml,
  fetchFileSize,
  type PageFetchOptions,
  type PageFetchResult,
} from '../shared/utils';

function buildEmbedUrl(url: string): string {
  const clean = url.split('?')[0].replace(/\/+$/u, '');
  return `${clean}/embed`;
}

export function fetchHtml(
  url: string,
  options: PageFetchOptions
): Promise<PageFetchResult | null> {
  return fetchPageHtml(url, options);
}

export function fetchEmbed(
  url: string,
  options: PageFetchOptions
): Promise<PageFetchResult | null> {
  return fetchPageHtml(buildEmbedUrl(url), options);
}

export { fetchFileSize };
