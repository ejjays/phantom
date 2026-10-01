import {
  buildVideoInfo,
  classifyThrown,
  noVideo,
  type VideoInfo,
} from '@phantom/extractors';
import { gatedFetch } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { LUNA_BASE } from './constants';
import { parseLunaMeta, parseWatchlunaUrl, type LunaMeta } from './parse';
import { VIDROCK_HEADERS, fetchVidrockSources, vidrockToFormats } from './vidrock';

export { parseWatchlunaUrl } from './parse';
export { decryptVidrockPayload } from './aesgcm';

async function fetchLunaMeta(origin: string, path: string): Promise<LunaMeta | null> {
  try {
    const res = await gatedFetch(`${origin}${path}`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) return null;
    const fallbackId = path.match(/(\d+)/u)?.[1] ?? path;
    return parseLunaMeta(await res.text(), fallbackId);
  } catch {
    return null;
  }
}

export async function getInfo(
  url: string,
  onPartial?: (info: VideoInfo) => void
): Promise<VideoInfo | null> {
  const ref = parseWatchlunaUrl(url);
  if (!ref) return null;

  try {
    const metaPath = ref.kind === 'movie' ? `/movie/${ref.tmdbId}` : `/tv/${ref.tmdbId}`;
    let pageOrigin = LUNA_BASE;
    try {
      pageOrigin = new URL(url).origin;
    } catch {
      pageOrigin = LUNA_BASE;
    }
    let meta: LunaMeta | null = null;
    for (const origin of [pageOrigin, LUNA_BASE]) {
      meta = await fetchLunaMeta(origin, metaPath);
      if (meta) break;
    }
    const title = meta?.title ?? `Watchluna ${ref.tmdbId}`;

    onPartial?.(
      buildVideoInfo({
        id: ref.tmdbId,
        title,
        uploader: 'Watchluna',
        webpageUrl: url,
        thumbnail: meta?.image,
        duration: meta?.durationSec,
        extractorKey: 'watchluna',
        isPartial: true,
      })
    );

    const sources = await fetchVidrockSources(ref);
    if (sources.length === 0) throw noVideo('Watchluna');

    const formats = await vidrockToFormats(sources, meta?.durationSec ?? 0);
    if (formats.length === 0) throw noVideo('Watchluna');

    return {
      type: 'video',
      id: ref.tmdbId,
      title,
      uploader: 'Watchluna',
      webpageUrl: url,
      thumbnail: meta?.image,
      duration: meta?.durationSec,
      description: meta?.description,
      formats,
      extractorKey: 'watchluna',
      isJsInfo: true,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: true,
      downloadHeaders: VIDROCK_HEADERS,
    };
  } catch (error) {
    throw classifyThrown(error, 'Watchluna');
  }
}
