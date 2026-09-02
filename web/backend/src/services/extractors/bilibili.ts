import { Readable } from 'node:stream';
import { createBilibiliExtractor } from '@phantom/extractors';
import { sharedBackendEnv } from './sharedEnv.js';
import type { Extractor, ExtractorOptions, VideoInfo } from '../../types/index.js';

const biliExtractor = createBilibiliExtractor(sharedBackendEnv);

export function getInfo(url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
  return biliExtractor.getInfo(url, options as unknown as Parameters<typeof biliExtractor.getInfo>[1]) as Promise<VideoInfo | null>;
}

export function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<Readable> {
  return biliExtractor.getStream(videoInfo as unknown as Parameters<typeof biliExtractor.getStream>[0], options as unknown as Parameters<typeof biliExtractor.getStream>[1]).then(
    (s) => Readable.fromWeb(s as unknown as import('node:stream/web').ReadableStream)
  );
}

export const bilibili: Extractor = {
  getInfo: getInfo as unknown as Extractor['getInfo'],
  getStream: getStream as unknown as Extractor['getStream'],
};
