import {
  createPinterestExtractor,
  parsePinId,
  ExtractorError,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';

const { getInfo: sharedGetInfo } = createPinterestExtractor(mobileSharedEnv);

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
      throw new ExtractorError(`Couldn't reach Pinterest. Check your connection and try again.`, true, true);
    }
    throw new ExtractorError(`Couldn't load this Pinterest pin. Please try again.`, true);
  }
}

export { parsePinId };
