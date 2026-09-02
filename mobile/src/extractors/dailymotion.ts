import { createDailymotionExtractor } from '@phantom/extractors';
import type { VideoInfo } from './shared/types';
import { ExtractorError } from './shared/types';
import { mobileSharedEnv } from './sharedEnv';

const { getInfo: sharedGetInfo } = createDailymotionExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    return (await sharedGetInfo(url)) as VideoInfo | null;
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'ExtractorError') {
      const err = error as { message: string; retryable: boolean; expected: boolean };
      throw new ExtractorError(err.message, err.retryable, err.expected);
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (/network|fetch|timeout|connection|abort|socket/iu.test(msg)) {
      throw new ExtractorError(`Couldn't reach Dailymotion. Check your connection and try again.`, true, true);
    }
    throw new ExtractorError(`Couldn't load this Dailymotion video. Please try again.`, true);
  }
}
