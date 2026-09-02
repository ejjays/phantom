import { createDailymotionExtractor } from '@phantom/extractors';
import { noVideo, classifyThrown } from './shared/errors';
import { mobileSharedEnv } from './sharedEnv';
import type { VideoInfo } from './shared/types';

const { getInfo: sharedGetInfo } = createDailymotionExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const info = (await sharedGetInfo(url)) as VideoInfo | null;
    if (!info) throw noVideo('Dailymotion');
    return info;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Dailymotion');
  }
}
