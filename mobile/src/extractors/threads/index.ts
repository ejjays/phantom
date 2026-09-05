import {
  createThreadsExtractor,
  classifyThrown,
  type VideoInfo,
  type ExtractorOptions,
} from '@phantom/extractors';
import { mobileSharedEnv } from '../shared/env';

const { getInfo: sharedGetInfo } = createThreadsExtractor(mobileSharedEnv);

export async function getInfo(
  url: string,
  options: ExtractorOptions = {}
): Promise<VideoInfo | null> {
  try {
    return (await sharedGetInfo(url, options)) as VideoInfo | null;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Threads');
  }
}
