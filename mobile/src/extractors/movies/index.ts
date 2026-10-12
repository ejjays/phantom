import {
  buildVideoInfo,
  classifyThrown,
  noVideo,
  type Format,
  type ProviderStreams,
  type VideoInfo,
} from '@phantom/extractors';
import { parseMovieUrl } from './parse';
import type { MovieRef } from './parse';
import { fetchTmdbTitle } from './tmdb';
import { log } from '../../lib/log';
import {
  isTransportDown,
  localDown,
  markLegDown,
  markLegUp,
} from '../../lib/providerHealth';
import {
  VIDROCK_HEADERS,
  fetchVidrockSources,
  vidrockToFormats,
} from './providers/vidrock';
import { fetchVidloveFormats } from './providers/vidlove';
import { fetchVixsrcFormats } from './providers/vixsrc';
import { fetchVidzeeFormats } from './providers/vidzee';
import { fetchParadiseFormats } from './providers/animeparadise';

export { parseMovieUrl } from './parse';
export { decryptVidrockPayload } from './providers/aesgcm';

function bestHeight(formats: Format[]): number {
  return formats.reduce((top, format) => Math.max(top, format.height ?? 0), 0);
}

type Leg = { formats: Format[]; headers: Record<string, string> } | null;

function groupOf(key: string, label: string, leg: Leg): ProviderStreams | null {
  if (!leg || leg.formats.length === 0) return null;
  return { key, label, formats: leg.formats, headers: leg.headers };
}

function takeover(
  pool: NonNullable<Leg>,
  spare: Leg,
  name: string,
  ref: MovieRef
): NonNullable<Leg> {
  if (spare === null || spare.formats.length === 0) return pool;
  if (bestHeight(spare.formats) <= bestHeight(pool.formats)) return pool;
  log(
    'Movies',
    `${name} upgrade for ${ref.kind}/${ref.tmdbId} formats=${spare.formats.length}`
  );
  return { formats: spare.formats, headers: spare.headers };
}

// all legs fire together: one dead provider costs a single wait, not a sum.
// legs the health check saw down are skipped outright instead of burning a timeout.
async function trackLeg(name: string, task: Promise<Leg>): Promise<Leg> {
  try {
    const out = await task;
    if (out && out.formats.length > 0) markLegUp(name);
    return out;
  } catch (err) {
    if (isTransportDown(err)) markLegDown(name);
    return null;
  }
}

async function trackRock(task: Promise<Format[]>): Promise<Format[]> {
  try {
    const out = await task;
    if (out.length > 0) markLegUp('vidrock');
    return out;
  } catch (err) {
    if (isTransportDown(err)) markLegDown('vidrock');
    return [];
  }
}

function fetchLegs(
  ref: MovieRef,
  title: string,
  durationSec: number,
  down: Set<string>
): Promise<[Format[], Leg, Leg, Leg, Leg]> {
  return Promise.all([
    down.has('vidrock')
      ? Promise.resolve([] as Format[])
      : trackRock(
          fetchVidrockSources(ref).then((sources) =>
            sources.length > 0
              ? vidrockToFormats(sources, durationSec, { quick: true })
              : []
          )
        ),
    down.has('vidlove')
      ? null
      : trackLeg('vidlove', fetchVidloveFormats(ref, durationSec)),
    down.has('vixsrc') ? null : trackLeg('vixsrc', fetchVixsrcFormats(ref)),
    down.has('vidzee') ? null : trackLeg('vidzee', fetchVidzeeFormats(ref)),
    down.has('paradise')
      ? null
      : trackLeg('paradise', fetchParadiseFormats(ref, title)),
  ]);
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
    const down = localDown();
    if (down.size > 0) {
      log(
        'Movies',
        `skip ${[...down].join(',')} for ${ref.kind}/${ref.tmdbId}`
      );
    }
    const [rockFormats, love, vix, zee, para] = await fetchLegs(
      ref,
      title,
      duration,
      down
    );

    let formats = rockFormats;
    let headers: Record<string, string> = { ...VIDROCK_HEADERS };
    const best = bestHeight(formats);
    if (best <= 1080) {
      if (formats.length === 0) {
        log(
          'Movies',
          `vidrock dry for ${ref.kind}/${ref.tmdbId}, trying vidlove`
        );
      } else {
        log(
          'Movies',
          `capped at ${best}p for ${ref.kind}/${ref.tmdbId}, trying vidlove`
        );
      }
      // strict upgrade only: equal labels lie (a "1080p" cam is worse than a
      // clean 720p), so a spare must genuinely clear the bar to take over
      ({ formats, headers } = takeover(
        { formats, headers },
        love,
        'vidlove',
        ref
      ));
      ({ formats, headers } = takeover(
        { formats, headers },
        vix,
        'vixsrc',
        ref
      ));
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

    const providers = [
      rockFormats.length > 0
        ? {
            key: 'vidrock',
            label: 'VidRock',
            formats: rockFormats,
            headers: { ...VIDROCK_HEADERS },
          }
        : null,
      groupOf('vidlove', 'VidLove', love),
      groupOf('vixsrc', 'VixSrc', vix),
      groupOf('vidzee', 'VidZee', zee),
      groupOf('paradise', 'Paradise', para),
    ].filter((entry): entry is ProviderStreams => entry !== null);

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
      providers,
    };
  } catch (error) {
    throw classifyThrown(error, 'Phantom');
  }
}
