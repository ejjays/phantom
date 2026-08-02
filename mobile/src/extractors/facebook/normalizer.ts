import type { VideoInfo } from '../types';
import type { FbParsed } from './types';
import { normalizeVideoInfo as normalize } from '@phantom/extractors/facebook/normalizer';

export const normalizeVideoInfo = (
  url: string,
  parsedData: FbParsed | null
): VideoInfo | null =>
  normalize(url, parsedData) as unknown as VideoInfo | null;
