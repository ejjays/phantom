import {
  createBilibiliExtractor,
  ExtractorError,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';
import { getBilibiliCookie } from '../lib/settings';

export async function getInfo(url: string): Promise<VideoInfo | null> {
  const cookie = await getBilibiliCookie();
  const env = cookie ? { ...mobileSharedEnv, cookie } : mobileSharedEnv;
  const { getInfo: sharedGetInfo } = createBilibiliExtractor(env as unknown as Parameters<typeof createBilibiliExtractor>[0]);
  try {
    return (await sharedGetInfo(url)) as VideoInfo | null;
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'ExtractorError') {
      const err = error as { message: string; retryable: boolean; expected: boolean };
      throw new ExtractorError(err.message, err.retryable, err.expected);
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (/network|fetch|timeout|connection|abort|socket/iu.test(msg)) {
      throw new ExtractorError(`Couldn't reach Bilibili. Check your connection and try again.`, true, true);
    }
    throw new ExtractorError(`Couldn't load this Bilibili video. Please try again.`, true);
  }
}
