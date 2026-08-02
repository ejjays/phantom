import { spawn } from 'node:child_process';
import { logger } from '../../utils/infra/logger.util.js';
import { Readable } from 'node:stream';
import { VideoInfo, ExtractorOptions } from '../../types/index.js';
import { secureFetch } from '../../utils/network/security.util.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let cachedClientId: string | null = null;
let lastClientIdFetch = 0;
const CLIENT_ID_EXPIRY = 3600000; // 1 hour

async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - lastClientIdFetch < CLIENT_ID_EXPIRY) {
    return cachedClientId;
  }

  try {
    logger.info('[SoundCloud] Fetching fresh client_id...');
    const response = await secureFetch('https://soundcloud.com', {
      headers: { 'User-Agent': UA },
    });
    const html = await response.text();
    const scriptUrls = html.match(/src="([^"]+\/assets\/[^"]+\.js)"/g) || [];

    for (const scriptTag of scriptUrls.reverse()) {
      const match = scriptTag.match(/src="([^"]+)"/u);
      if (!match) continue;
      const url = match[1];
      const scriptRes = await secureFetch(url);
      const scriptBody = await scriptRes.text();
      const idMatch = scriptBody.match(/client_id:"([a-zA-Z0-9]{32})"/u);
      if (idMatch) {
        cachedClientId = idMatch[1];
        lastClientIdFetch = Date.now();
        logger.info(`[SoundCloud] Found client_id: ${cachedClientId}`);
        return cachedClientId;
      }
    }
  } catch (error: unknown) {
    logger.error(
      '[SoundCloud] Failed to fetch client_id:',
      error instanceof Error ? error.message : String(error)
    );
  }
  return cachedClientId;
}

export async function search(query: string): Promise<unknown[]> {
  const clientId = await getClientId();
  if (!clientId) return [];

  try {
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=5`;
    const response = await secureFetch(url);
    const { collection } = (await response.json()) as {
      collection?: unknown[];
    };
    return collection ?? [];
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('[SoundCloud] Search error:', error.message);
    } else {
      logger.error('[SoundCloud] Search error:', error);
    }
    return [];
  }
}

interface SoundCloudTranscoding {
  url: string;
  format: {
    protocol: string;
    mime_type: string;
  };
}

interface SoundCloudTrack {
  policy: string;
  duration: number;
  full_duration: number;
  title: string;
  media?: {
    transcodings?: SoundCloudTranscoding[];
  };
  id: string | number;
  user?: {
    username: string;
    avatar_url?: string;
  };
  artwork_url?: string;
}

export async function getInfo(
  url: string,
  _options: ExtractorOptions = {}
): Promise<VideoInfo> {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Could not obtain SoundCloud client_id');
  logger.info(
    `[Metadata] Engine: Pure-JS | Platform: SoundCloud | URL: ${url}`
  );

  try {
    const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`;
    const response = await secureFetch(resolveUrl);
    if (!response.ok)
      throw new Error(`Failed to resolve SoundCloud URL: ${response.status}`);
    const track = (await response.json()) as SoundCloudTrack;

    const isSnippet =
      track.policy === 'SNIPPET' ||
      (track.duration < 60000 && track.full_duration > 60000);
    if (isSnippet) {
      logger.warn(
        `[SoundCloud] Rejected snippet: ${track.title} (${(track.duration / 1000).toFixed(1)}s)`
      );
      throw new Error('This track is a preview snippet only.');
    }

    const transcoding =
      track.media?.transcodings?.find(
        (transcodingItem) => transcodingItem.format.protocol === 'progressive'
      ) ||
      track.media?.transcodings?.find(
        (transcodingItem) => transcodingItem.format.protocol === 'hls'
      );

    if (!transcoding)
      throw new Error('No supported stream found for this track');

    return {
      type: 'video',
      id: track.id.toString(),
      extractorKey: 'soundcloud',
      isJsInfo: true,
      title: track.title,
      author: track.user?.username || 'Unknown',
      uploader: track.user?.username || 'Unknown',
      duration: track.duration / 1000,
      thumbnail: track.artwork_url || track.user?.avatar_url || '',
      webpageUrl: url,
      formats: [
        {
          formatId: 'audio',
          url: transcoding.url,
          extension: 'mp3',
          resolution: 'Audio',
          acodec: 'mp3',
          abr: 128,
          isAudio: true,
          isVideo: false,
          isMuxed: false,
          note: transcoding.format.protocol,
        },
      ],
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: false,
    };
  } catch (error: unknown) {
    logger.error(
      '[SoundCloud] getInfo error:',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

export async function getStream(
  info: VideoInfo,
  _options: ExtractorOptions = {}
): Promise<Readable> {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Missing client_id');

  const format = info.formats[0];
  const response = await secureFetch(`${format.url}?client_id=${clientId}`);
  const { url: directUrl } = (await response.json()) as { url: string };
  if (!directUrl) throw new Error('No stream URL resolved');

  // hls -> transcode to single mp3 stream
  if (format.note?.includes('hls') || directUrl.includes('.m3u8')) {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        UA,
        '-i',
        directUrl,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '2',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    (ffmpeg.stdio[2] as Readable | null)?.resume();
    ffmpeg.on('error', (err: Error) =>
      logger.error(`[SoundCloud] ffmpeg error: ${err.message}`)
    );
    return ffmpeg.stdout as Readable;
  }

  const streamResponse = await secureFetch(directUrl);
  if (!streamResponse.body) throw new Error('No stream body');
  return Readable.fromWeb(
    streamResponse.body as import('node:stream/web').ReadableStream
  );
}
