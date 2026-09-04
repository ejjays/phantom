import { createBlueskyExtractor } from '@phantom/extractors';
import { noVideo, classifyThrown } from './shared/errors';
import { mobileSharedEnv } from './shared/env';
import type { VideoInfo } from './shared/types';

const { getInfo: sharedGetInfo } = createBlueskyExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const info = (await sharedGetInfo(url)) as VideoInfo | null;
    if (!info) throw noVideo('Bluesky');
    return info;
  } catch (error: unknown) {
    if (error instanceof Error && /network|fetch|timeout/iu.test(error.message)) {
      throw classifyThrown(error, 'Bluesky');
    }
    throw error;
  }
}