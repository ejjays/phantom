import {
  buildVideoInfo,
  classifyThrown,
  noVideo,
  type Format,
  type VideoInfo,
} from '@phantom/extractors';
import { parseMovieUrl } from './parse';
import { fetchTmdbTitle } from './tmdb';
import { log } from '../../lib/log';
import {
  VIDROCK_HEADERS,
  fetchVidrockSources,
  vidrockToFormats,
} from './vidrock';
import { fetchVidloveFormats } from './vidlove';

export { parseMovieUrl } from './parse';
export { decryptVidrockPayload } from './aesgcm';

function bestHeight(formats: Format[]): number {
  return formats.reduce((top, format) => Math.max(top, format.height ?? 0), 0);
}

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

    const sources = await fetchVidrockSources(ref).catch(() => []);
    let formats =
      sources.length > 0
        ? await vidrockToFormats(sources, meta?.durationSec ?? 0, {
            quick: true,
          })
        : [];
    let headers: Record<string, string> = { ...VIDROCK_HEADERS };
    const rockBest = bestHeight(formats);
    if (rockBest <= 1080) {
      if (formats.length === 0) {
        log('Movies', `vidrock dry for ${ref.kind}/${ref.tmdbId}, trying vidlove`);
      } else {
        log(
          'Movies',
          `vidrock capped at ${rockBest}p for ${ref.kind}/${ref.tmdbId}, trying vidlove`
        );
      }
      const fallback = await fetchVidloveFormats(
        ref,
        meta?.durationSec ?? 0
      ).catch(() => null);
      const loveBest = fallback ? bestHeight(fallback.formats) : 0;
      if (fallback && loveBest > 0 && loveBest >= rockBest) {
        formats = fallback.formats;
        headers = fallback.headers;
        log(
          'Movies',
          `vidlove upgrade for ${ref.kind}/${ref.tmdbId} formats=${formats.length}`
        );
      }
    }
    if (formats.length === 0) throw noVideo('Phantom');

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
