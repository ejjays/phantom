import { describe, it } from 'vitest';
import { z } from 'zod';
import { getVideoInfo } from '../../src/services/ytdlp.service.js';
import { VideoInfo } from '../../src/types/index.js';
import rawCases from '../fixtures/live.json';
import { CaseSchema } from '../utils/schema.js';
import { assertOutcome } from '../utils/assert.js';

// load cases
const testCases = z.array(CaseSchema).parse(rawCases);

describe('live monitoring', () => {
  it.each(testCases)(
    'check $name',
    {
      timeout: 60000,
      retry: 2,
    },
    async ({ url, expected }) => {
      const startTime = performance.now();

      // setup cookies
      const run = async (attempt = 1): Promise<VideoInfo | null> => {
        try {
          return await getVideoInfo(url, [], false, null, `bot-${attempt}`);
        } catch (err) {
          const errorMsg = (err as Error).message;
          if (
            errorMsg.includes('Sign in to confirm you’re not a bot') ||
            errorMsg.includes('Requested format is not available')
          ) {
            console.warn(
              `[live] Skipping test due to bot detection in CI: ${errorMsg}`
            );
            return null;
          }
          if (attempt < 3) {
            console.warn(`[live] retry ${attempt} for ${url}`);
            await new Promise((res) => setTimeout(res, 2000));
            return run(attempt + 1);
          }
          throw err;
        }
      };

      const info = await run();
      if (!info) return; // network request

      const duration = (performance.now() - startTime) / 1000;

      // check meta
      assertOutcome(info, expected);

      if (duration > 15) {
        console.warn(`[live] slow response: ${duration.toFixed(2)}s`);
      }

      console.log(`[live] ${info?.title} ok (${duration.toFixed(2)}s)`);
    }
  );
});
