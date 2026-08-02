import type { VideoInfo } from '../types';
import type { ThreadsParsed } from './types';
import { normalizeVideoInfo as normalize } from '@phantom/extractors/threads/normalizer';

export const normalizeVideoInfo = (
  url: string,
  parsedData: ThreadsParsed | null
): VideoInfo | null =>
  normalize(url, parsedData) as unknown as VideoInfo | null;
