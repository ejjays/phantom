import type { ExtractorEnv } from '@phantom/extractors';
import { gatedFetch } from '../lib/net';
import { error as logError } from '../lib/log';

// gatedFetch is the same reference as env.fetch, so test mocks for gatedFetch
// flow through to the shared factories transparently.
export const mobileSharedEnv: ExtractorEnv = {
  fetch: gatedFetch as unknown as typeof fetch,
  async streamUrl(url, headers) {
    const res = await gatedFetch(url, { headers });
    if (!res.ok || !res.body) {
      throw new Error(`streamUrl: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.body as unknown as ReadableStream;
  },
};

// mobile bluesky/vimeo pull extra thumbs as fail-soft fallbacks
export async function oembedThumbImpl(url: string): Promise<string | undefined> {
  try {
    const res = await gatedFetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { thumbnail_url?: string };
    return data.thumbnail_url;
  } catch (err) {
    logError('sharedEnv', `oembedThumb failed: ${(err as Error).message}`);
    return undefined;
  }
}

export async function ogImageThumbImpl(
  url: string
): Promise<string | undefined> {
  try {
    const res = await gatedFetch(url);
    if (!res.ok) return undefined;
    const html = await res.text();
    const match =
      /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/iu.exec(
        html
      );
    return match?.[1]?.replace(/&amp;/gu, '&') ?? undefined;
  } catch (err) {
    logError('sharedEnv', `ogImageThumb failed: ${(err as Error).message}`);
    return undefined;
  }
}

export const mobileSharedEnvWithThumbs: ExtractorEnv = {
  ...mobileSharedEnv,
  oembedThumb: oembedThumbImpl,
  ogImageThumb: ogImageThumbImpl,
};