import { createXExtractor } from '@phantom/extractors';
import { Readable } from 'node:stream';
import { secureFetch } from '../../utils/network/security.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import { VideoInfo, ExtractorOptions } from '../../types/index.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const x = createXExtractor({
  fetch: (input, init) =>
    secureFetch(input instanceof Request ? input.url : input, init),
  streamUrl: (url, headers) =>
    Promise.resolve(
      Readable.toWeb(getProxiedStream(url, headers)) as unknown as ReadableStream
    ),
});

export const getInfo = x.getInfo;

export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const selected =
    videoInfo.formats.find(
      (format) => String(format.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!selected?.url) throw new Error('No stream URL found');

  return Promise.resolve(
    getProxiedStream(selected.url, {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://x.com/',
    })
  );
}
