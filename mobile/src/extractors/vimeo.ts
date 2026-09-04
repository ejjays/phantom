import { createVimeoExtractor } from '@phantom/extractors';
import { noVideo, classifyThrown } from './shared/errors';
import { mobileSharedEnvWithThumbs } from './shared/env';
import type { VideoInfo } from './shared/types';

const { getInfo: sharedGetInfo } = createVimeoExtractor(
  mobileSharedEnvWithThumbs
);

const VIMEO_URL_RE =
  /(?:player\.vimeo\.com\/video\/|vimeo\.com\/(?:video\/)?)\d+/iu;

export async function getInfo(url: string): Promise<VideoInfo | null> {
  // legacy contract: non-vimeo → null, valid url but no video → throw
  if (!VIMEO_URL_RE.test(url)) return null;
  try {
    const info = (await sharedGetInfo(url)) as VideoInfo | null;
    if (!info) throw noVideo('Vimeo');
    return info;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Vimeo');
  }
}