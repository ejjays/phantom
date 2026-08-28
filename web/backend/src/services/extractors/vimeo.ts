import { createVimeoExtractor } from '@phantom/extractors';
import { spawn } from 'node:child_process';
import { logger } from '../../utils/infra/logger.util.js';
import { Readable } from 'node:stream';
import { secureFetch } from '../../utils/network/security.util.js';
import { getProxiedStream } from '../../utils/network/proxy.util.js';
import { VideoInfo, ExtractorOptions } from '../../types/index.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const vimeo = createVimeoExtractor({
  fetch: (input, init) =>
    secureFetch(input instanceof Request ? input.url : input, init),
  streamUrl: (url, headers) =>
    Promise.resolve(
      Readable.toWeb(getProxiedStream(url, headers)) as unknown as ReadableStream
    ),
});

export const getInfo = vimeo.getInfo;

export function getStream(
  videoInfo: VideoInfo,
  options: ExtractorOptions = {}
): Promise<Readable> {
  const selected =
    videoInfo.formats.find(
      (format) => String(format.formatId) === String(options.formatId)
    ) || videoInfo.formats[0];
  if (!selected?.url) throw new Error('No stream URL found');

  // progressive direct mp4; only hls needs remux
  if (selected.note?.includes('hls') || selected.url.includes('.m3u8')) {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        UA,
        '-i',
        selected.url,
        '-c',
        'copy',
        '-bsf:a',
        'aac_adtstoasc',
        '-f',
        'mp4',
        '-movflags',
        '+frag_keyframe+empty_moov+default_base_moof',
        '-frag_duration',
        '1000000',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    (ffmpeg.stdio[2] as Readable | null)?.resume();
    ffmpeg.on('error', (err: Error) =>
      logger.error(`[JS-Vimeo] ffmpeg error: ${err.message}`)
    );
    return Promise.resolve(ffmpeg.stdout as Readable);
  }

  return Promise.resolve(getProxiedStream(selected.url, {}));
}
