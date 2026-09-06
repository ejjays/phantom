import { Readable } from 'node:stream';
import type { ExtractorEnv } from '@phantom/extractors';
import { secureFetch } from '../../utils/network/security.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import { hlsRemuxStream } from '../ytdlp/turbo-mux.js';

const HLS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function remuxHls(
  url: string,
  _headers: Record<string, string>
): Promise<ReadableStream> {
  return Promise.resolve(
    Readable.toWeb(hlsRemuxStream(url, HLS_UA)) as unknown as ReadableStream
  );
}

function streamUrl(
  url: string,
  headers: Record<string, string>
): Promise<ReadableStream> {
  return Promise.resolve(
    Readable.toWeb(getProxiedStream(url, headers)) as unknown as ReadableStream
  );
}

export const sharedBackendEnv: ExtractorEnv = {
  fetch: secureFetch as unknown as typeof fetch,
  streamUrl,
  remuxHls,
  skipDurationFetch: true,
  get cookie() {
    return process.env.BILIBILI_COOKIE?.trim() || undefined;
  },
};