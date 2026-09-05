import {
  createTwitchExtractor,
  classifyThrown,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';
import type { OnPartial } from './index';

const { getInfo: sharedGetInfo } = createTwitchExtractor(mobileSharedEnv);

export async function getInfo(
  url: string,
  onPartial?: OnPartial
): Promise<VideoInfo | null> {
  try {
    return (await sharedGetInfo(
      url,
      onPartial ? { onPartial: onPartial as (info: VideoInfo) => void } : {}
    )) as VideoInfo | null;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Twitch');
  }
}
