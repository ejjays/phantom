import { describe, it, expect, vi } from 'vitest';
import cases from './live-cases.json';

// authFetch's cookieGet is native (rn fetch drops manual Cookie headers); shim
// to node fetch here since node keeps them — only instagram uses authFetch.
vi.mock('../../src/lib/authFetch', () => ({
  cookieGet: async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  },
}));

import { getInfo as facebookGetInfo } from '../../src/extractors/facebook';
import { getInfo as threadsGetInfo } from '../../src/extractors/threads';
import { getInfo as xGetInfo } from '../../src/extractors/x';
import { getInfo as tiktokGetInfo } from '../../src/extractors/tiktok';
import { getInfo as vimeoGetInfo } from '../../src/extractors/vimeo';
import { getInfo as dailymotionGetInfo } from '../../src/extractors/dailymotion';
import { getInfo as soundcloudGetInfo } from '../../src/extractors/soundcloud';
import { getInfo as redditGetInfo } from '../../src/extractors/reddit';
import { getInfo as blueskyGetInfo } from '../../src/extractors/bluesky';
import { getInfo as instagramGetInfo } from '../../src/extractors/instagram';
import { getInfo as pinterestGetInfo } from '../../src/extractors/pinterest';
import { getInfo as twitchGetInfo } from '../../src/extractors/twitch';
import { ExtractorError, type VideoInfo } from '../../src/extractors/types';
import {
  noVideo,
  notFound,
  loginRequired,
  restricted,
  rateLimited,
  serverError,
  networkError,
} from '../../src/extractors/errors';

const RESOLVERS = {
  facebook: facebookGetInfo,
  threads: threadsGetInfo,
  x: xGetInfo,
  tiktok: tiktokGetInfo,
  vimeo: vimeoGetInfo,
  dailymotion: dailymotionGetInfo,
  soundcloud: soundcloudGetInfo,
  reddit: redditGetInfo,
  bluesky: blueskyGetInfo,
  instagram: instagramGetInfo,
  pinterest: pinterestGetInfo,
  twitch: twitchGetInfo,
} satisfies Record<string, (url: string) => Promise<VideoInfo | null>>;

type LiveCase = {
  name: string;
  extractor: keyof typeof RESOLVERS;
  url: string;
  expect: {
    minFormats: number;
    mediaKind?: 'video' | 'audio';
    rejectUploader?: string;
  };
};

const RUN_LIVE = process.env.VITEST_INCLUDE_LIVE === '1';

// noVideo (!retryable && !expected) = page loaded but parser found nothing =
// real regression → fail. everything else (transient/blocked/removed) skips.
function classifyLiveFailure(error: unknown): {
  action: 'skip' | 'fail';
  reason: string;
} {
  if (!(error instanceof ExtractorError)) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: 'fail', reason: `unexpected crash: ${msg}` };
  }
  if (error.retryable) {
    return { action: 'skip', reason: `transient/blocked: ${error.message}` };
  }
  if (error.expected) {
    // access/content state, not parser bug. removed = fixture URL rotted →
    // refresh live-cases.json.
    return { action: 'skip', reason: `unavailable: ${error.message}` };
  }
  return { action: 'fail', reason: `parser found no media: ${error.message}` };
}

describe.skipIf(!RUN_LIVE)('live extractor health', () => {
  for (const testCase of cases as LiveCase[]) {
    it(testCase.name, { timeout: 45000, retry: 2 }, async (ctx) => {
      // instagram authFetch needs a logged-in cookie to see media URLs
      if (
        testCase.extractor === 'instagram' &&
        !process.env.EXPO_PUBLIC_IG_COOKIE
      ) {
        ctx.skip('EXPO_PUBLIC_IG_COOKIE not set');
        return;
      }
      const resolve = RESOLVERS[testCase.extractor];
      let info: VideoInfo | null;
      try {
        info = await resolve(testCase.url);
      } catch (error) {
        const verdict = classifyLiveFailure(error);
        if (verdict.action === 'skip') {
          ctx.skip(verdict.reason);
          return;
        }
        throw new Error(
          `[${testCase.extractor}] ${testCase.url} — ${verdict.reason}`
        );
      }

      expect(
        info,
        'resolver returned null for a supported host'
      ).not.toBeNull();
      const video = info as VideoInfo;
      // reject logged-out fallback (e.g. fb's generic "Facebook User")
      if (testCase.expect.rejectUploader) {
        expect(video.uploader).not.toBe(testCase.expect.rejectUploader);
      }
      expect(video.title.trim().length).toBeGreaterThan(0);
      expect(video.formats.length).toBeGreaterThanOrEqual(
        testCase.expect.minFormats
      );
      // real media stream, not a thumbnail/photo fallback
      const wantAudio = testCase.expect.mediaKind === 'audio';
      expect(
        video.formats.some((format) =>
          wantAudio ? format.isAudio : format.isVideo
        )
      ).toBe(true);
      for (const format of video.formats) {
        expect(format.url).toMatch(/^https?:\/\//u);
      }
    });
  }
});

// youtube + spotify only resolve via on-device WebView (BotGuard+cipher) — never headless.
describe('live (webview-only extractors)', () => {
  it.todo('youtube — WebView-only, not headless-testable');
  it.todo('spotify — WebView-only (audio via youtube), not headless-testable');
});

// no network — runs in normal suite/CI, unlike gated live cases above.
describe('live failure classifier', () => {
  it.each([
    ['noVideo — parser found nothing', noVideo('Test'), 'fail'],
    ['raw non-ExtractorError crash', new Error('boom'), 'fail'],
    ['notFound — dead fixture URL', notFound('Test'), 'skip'],
    ['loginRequired — bot-wall', loginRequired('Test'), 'skip'],
    ['restricted', restricted('Test'), 'skip'],
    ['rateLimited — 429', rateLimited('Test'), 'skip'],
    ['serverError — 5xx', serverError('Test'), 'skip'],
    ['networkError — transient', networkError('Test'), 'skip'],
  ] as const)('%s -> %s', (_name, error, expected) => {
    expect(classifyLiveFailure(error).action).toBe(expected);
  });
});
