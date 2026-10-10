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
import { fetchVidzeeFormats } from './vidzee';
import { fetchParadiseFormats } from './animeparadise';

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

    const duration = meta?.durationSec ?? 0;
    // all legs fire together: one dead provider costs a single wait, not a sum
    const [rockFormats, love, zee, para] = await Promise.all([
      fetchVidrockSources(ref)
        .then((sources) =>
          sources.length > 0
            ? vidrockToFormats(sources, duration, { quick: true })
            : []
        )
        .catch(() => [] as Format[]),
      fetchVidloveFormats(ref, duration).catch(() => null),
      fetchVidzeeFormats(ref).catch(() => null),
      fetchParadiseFormats(ref, title).catch(() => null),
    ]);

    let formats = rockFormats;
    let headers: Record<string, string> = { ...VIDROCK_HEADERS };
    const rockBest = bestHeight(formats);
    if (rockBest <= 1080) {
      if (formats.length === 0) {
        log(
          'Movies',
          `vidrock dry for ${ref.kind}/${ref.tmdbId}, trying vidlove`
        );
      } else {
        log(
          'Movies',
          `vidrock capped at ${rockBest}p for ${ref.kind}/${ref.tmdbId}, trying vidlove`
        );
      }
      // strict upgrade only: equal labels lie (a "1080p" cam is worse than a
      // clean 720p), so vidlove must genuinely clear the bar to take over
      const loveBest = love ? bestHeight(love.formats) : 0;
      if (love && loveBest > rockBest) {
        formats = love.formats;
        headers = love.headers;
        log(
          'Movies',
          `vidlove upgrade for ${ref.kind}/${ref.tmdbId} formats=${formats.length}`
        );
      }
    }
    if (formats.length === 0) {
      const spare =
        zee && zee.formats.length > 0
          ? { name: 'vidzee', ...zee }
          : para && para.formats.length > 0
            ? { name: 'paradise', ...para }
            : null;
      if (spare) {
        formats = spare.formats;
        headers = spare.headers;
        log(
          'Movies',
          `${spare.name} for ${ref.kind}/${ref.tmdbId} formats=${formats.length}`
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
