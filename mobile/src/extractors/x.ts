import {
  createXExtractor,
  classifyThrown,
  type VideoInfo as SharedVideoInfo,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';

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