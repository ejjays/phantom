import {
  buildVideoInfo,
  classifyThrown,
  noVideo,
  type VideoInfo,
} from '@phantom/extractors';
import { gatedFetch } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import { LUNA_BASE } from './constants';
import { parseLunaMeta, parseWatchlunaUrl } from './parse';
import { VIDROCK_HEADERS, fetchVidrockSources, vidrockToFormats } from './vidrock';

export { parseWatchlunaUrl } from './parse';
export { decryptVidrockPayload } from './aesgcm';

async function fetchLunaMeta(
  path: string,
  fallbackId: string
): Promise<{ title: string; image?: string; durationSec?: number; description?: string }> {
  try {
    const res = await gatedFetch(`${LUNA_BASE}${path}`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) return { title: `Watchluna ${fallbackId}` };
    return parseLunaMeta(await res.text(), fallbackId);
  } catch {
    return { title: `Watchluna ${fallbackId}` };
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
    const meta = await fetchLunaMeta(metaPath, ref.tmdbId);

    onPartial?.(
      buildVideoInfo({
        id: ref.tmdbId,
        title: meta.title,
        uploader: 'Watchluna',
        webpageUrl: url,
        thumbnail: meta.image,
        duration: meta.durationSec,
        extractorKey: 'watchluna',
        isPartial: true,
      })
    );

    const sources = await fetchVidrockSources(ref);
    if (sources.length === 0) throw noVideo('Watchluna');

    const formats = await vidrockToFormats(sources, meta.durationSec ?? 0);
    if (formats.length === 0) throw noVideo('Watchluna');

    return {
      type: 'video',
      id: ref.tmdbId,
      title: meta.title,
      uploader: 'Watchluna',
      webpageUrl: url,
      thumbnail: meta.image,
      duration: meta.durationSec,
      description: meta.description,
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
