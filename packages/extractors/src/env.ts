export interface ExtractorEnv {
  fetch: typeof fetch;
  streamUrl(
    url: string,
    headers: Record<string, string>
  ): Promise<ReadableStream>;
  // HLS needs remuxing to mp4; unset means getStream() throws instead of shelling out to ffmpeg
  remuxHls?(
    url: string,
    headers: Record<string, string>
  ): Promise<ReadableStream>;
  // skip the extra round-trip to fetch hls runtime (web backend doesn't need it)
  skipDurationFetch?: boolean;
  // vimeo: pull oembed thumb when config thumbs empty
  oembedThumb?(url: string): Promise<string | undefined>;
  // vimeo: scrape og:image as last-resort thumbnail
  ogImageThumb?(url: string): Promise<string | undefined>;
}

export const defaultEnv: ExtractorEnv = {
  fetch: (...args) => globalThis.fetch(...args),
  async streamUrl(url, headers) {
    const res = await globalThis.fetch(url, { headers });
    if (!res.ok || !res.body) {
      throw new Error(`streamUrl: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.body;
  },
};