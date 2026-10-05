import {
  buildVideoInfo,
  classifyThrown,
  noVideo,
  type VideoInfo,
} from '@phantom/extractors';
import { parseMovieUrl } from './parse';
import { fetchTmdbTitle } from './tmdb';
import {
  VIDROCK_HEADERS,
  fetchVidrockSources,
  vidrockToFormats,
} from './vidrock';

export { parseMovieUrl } from './parse';
export { decryptVidrockPayload } from './aesgcm';

export async function getInfo(
  url: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  const ref = parseMovieUrl(url);
  if (!ref) return null;

  try {
    const meta = await fetchTmdbTitle(ref.kind, ref.tmdbId).catch(() => null);
    const title = meta?.title ?? `Phantom ${ref.tmdbId}`;

    onPartial?.(
      buildVideoInfo({
        id: ref.tmdbId,
        title,
        uploader: 'Phantom',
        webpageUrl: url,
        thumbnail: meta?.image,
        duration: meta?.durationSec,
        extractorKey: 'phantom',
        isPartial: true,
      })
    );

    const sources = await fetchVidrockSources(ref);
    if (sources.length === 0) throw noVideo('Phantom');

    const formats = await vidrockToFormats(sources, meta?.durationSec ?? 0, { quick: true });
    if (formats.length === 0) throw noVideo('Phantom');
    const headers: Record<string, string> = { ...VIDROCK_HEADERS };

    return {
      type: 'video',
      id: ref.tmdbId,
      title,
      uploader: 'Phantom',
      webpageUrl: url,
      thumbnail: meta?.image,
      duration: meta?.durationSec,
      description: meta?.description,
      formats,
      extractorKey: 'phantom',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: true,
      downloadHeaders: headers,
    };
  } catch (error) {
    throw classifyThrown(error, 'Phantom');
  }
}
