import {
  createTikTokExtractor,
  classifyThrown,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';
import { error as logError } from '../lib/log';

export { parseUniversalData } from '@phantom/extractors';

const { getInfo: sharedGetInfo } = createTikTokExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    return (await sharedGetInfo(url)) as VideoInfo | null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError('tiktok', `[JS-TikTok] Error extracting ${url}: ${message}`);
    throw classifyThrown(error, 'TikTok');
  }
}
