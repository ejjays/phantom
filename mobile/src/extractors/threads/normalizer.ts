import type { VideoInfo } from '@phantom/extractors';
import type { ThreadsParsed } from '@phantom/extractors/threads/types';
import { normalizeVideoInfo as normalize } from '@phantom/extractors/threads/normalizer';

export const normalizeVideoInfo = (
  url: string,
  parsedData: ThreadsParsed | null
): VideoInfo | null =>
  normalize(url, parsedData) as unknown as VideoInfo | null;
