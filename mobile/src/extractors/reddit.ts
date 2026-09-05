import {
  createRedditExtractor,
  classifyThrown,
  type VideoInfo,
} from '@phantom/extractors';
import { mobileSharedEnv } from './shared/env';
import { mapLimit } from '../lib/net';
import { DESKTOP_UA } from '../lib/userAgents';
import { probeFileSize } from './shared/utils';

const { getInfo: sharedGetInfo } = createRedditExtractor(mobileSharedEnv);

export async function getInfo(url: string): Promise<VideoInfo | null> {
  try {
    const info = (await sharedGetInfo(url)) as VideoInfo | null;
    if (!info) return null;

    const audioUrl = info.formats.find((f) => f.muxAudioUrl)?.muxAudioUrl;
    const audioSize = audioUrl
      ? ((await probeFileSize(audioUrl, { 'User-Agent': DESKTOP_UA })) ?? 0)
      : 0;
    await mapLimit(info.formats, 3, async (format) => {
      if (!format.url || format.filesize) return;
      const videoSize = await probeFileSize(format.url, {
        'User-Agent': DESKTOP_UA,
      });
      if (videoSize) format.filesize = videoSize + audioSize;
    });

    return info;
  } catch (error: unknown) {
    throw classifyThrown(error, 'Reddit');
  }
}
