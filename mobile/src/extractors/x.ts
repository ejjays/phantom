import {
  createXExtractor,
  type VideoInfo as SharedVideoInfo,
} from '@phantom/extractors';
import { classifyThrown } from './shared/errors';
import { mobileSharedEnv } from './shared/env';
import type { VideoInfo } from './shared/types';

const { getInfo: sharedGetInfo } = createXExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const info = (await sharedGetInfo(url, {
      isAudioMuxed: true,
    })) as VideoInfo | null;
    if (!info) return null;
    return info;
  } catch (error: unknown) {
    throw classifyThrown(error, 'X');
  }
}

export { tweetToken } from '@phantom/extractors';
export type { SharedVideoInfo };