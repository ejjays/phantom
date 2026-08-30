import {
  createXExtractor,
  type VideoInfo as SharedVideoInfo,
} from '@phantom/extractors';
import { classifyThrown } from './shared/errors';
import { mobileSharedEnv } from './sharedEnv';
import type { VideoInfo } from './shared/types';

const { getInfo: sharedGetInfo } = createXExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const info = (await sharedGetInfo(url, {
      isAudioMuxed: true,
    })) as VideoInfo | null;
    if (!info) return null;
    // don't overwrite existing downloadHeaders — App may layer its own
    return info;
  } catch (error: unknown) {
    throw classifyThrown(error, 'X');
  }
}

// re-export so callers don't break if they imported tweetToken directly
export { tweetToken } from '@phantom/extractors';
export type { SharedVideoInfo };