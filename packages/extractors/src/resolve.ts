import { Extractor, VideoInfo } from './types.js';
import { ExtractorEnv, defaultEnv } from './env.js';
import { createXExtractor } from './x.js';
import { createBlueskyExtractor } from './bluesky.js';
import { createVimeoExtractor } from './vimeo.js';
import { createDailymotionExtractor } from './dailymotion.js';
import { createPinterestExtractor } from './pinterest.js';
import { createRedditExtractor } from './reddit.js';
import { createSnapchatExtractor } from './snapchat.js';
import { createTwitchExtractor } from './twitch.js';
import { createSoundCloudExtractor } from './soundcloud.js';
import { createBilibiliExtractor } from './bilibili.js';

function hostOf(url: string): string {
  const cleaned = url.replace(/^https?:\/\//iu, '');
  return cleaned.split(/[/?#]/u)[0].toLowerCase();
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// host -> extractor, one env shared across whichever extractor gets picked
export function getExtractor(
  url: string,
  env: ExtractorEnv = defaultEnv
): Extractor | null {
  const host = hostOf(url);
  if (matches(host, 'x.com') || matches(host, 'twitter.com')) {
    return createXExtractor(env);
  }
  if (matches(host, 'bsky.app')) {
    return createBlueskyExtractor(env);
  }
  if (matches(host, 'vimeo.com')) {
    return createVimeoExtractor(env);
  }
  if (matches(host, 'dailymotion.com') || matches(host, 'dai.ly')) {
    return createDailymotionExtractor(env);
  }
  if (matches(host, 'pinterest.com') || matches(host, 'pinterest.co.uk') || matches(host, 'pin.it')) {
    return createPinterestExtractor(env);
  }
  if (matches(host, 'reddit.com') || matches(host, 'redd.it') || matches(host, 'old.reddit.com')) {
    return createRedditExtractor(env);
  }
  if (
    matches(host, 'snapchat.com') ||
    matches(host, 't.snapchat.com') ||
    matches(host, 'story.snapchat.com')
  ) {
    return createSnapchatExtractor(env);
  }
  if (matches(host, 'twitch.tv') || matches(host, 'clip.twitch.tv')) {
    return createTwitchExtractor(env);
  }
  if (matches(host, 'soundcloud.com') || matches(host, 'on.soundcloud.com')) {
    return createSoundCloudExtractor(env);
  }
  if (matches(host, 'bilibili.tv') || matches(host, 'bilibili.com') || matches(host, 'biliintl.com') || matches(host, 'bili.im')) {
    return createBilibiliExtractor(env);
  }
  return null;
}

// convenience: getExtractor + getInfo in one call, for when you don't need getStream too
export async function resolve(
  url: string,
  env: ExtractorEnv = defaultEnv
): Promise<VideoInfo | null> {
  const extractor = getExtractor(url, env);
  if (!extractor) return null;
  return extractor.getInfo(url);
}
