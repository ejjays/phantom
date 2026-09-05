import {
  createFacebookExtractor,
  classifyThrown,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from '../shared/env';

const { getInfo: sharedGetInfo } = createFacebookExtractor(mobileSharedEnv);

export async function getInfo(
  url: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  try {
    return (await sharedGetInfo(
      url,
      onPartial ? { onPartial } : {}
    )) as VideoInfo | null;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Facebook');
  }
}
