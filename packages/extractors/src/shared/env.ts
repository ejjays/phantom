export interface ExtractorEnv {
  fetch: typeof fetch;
  streamUrl(
    url: string,
    headers: Record<string, string>
  ): Promise<ReadableStream>;
  remuxHls?(
    url: string,
    headers: Record<string, string>
  ): Promise<ReadableStream>;
  skipDurationFetch?: boolean;
  oembedThumb?(url: string): Promise<string | undefined>;
  ogImageThumb?(url: string): Promise<string | undefined>;
  cookie?: string;
  fetchSessionHeaders?: (
    url: string,
    headers: Record<string, string>
  ) => Promise<{ ok: boolean; status: number; setCookie: string | null }>;
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