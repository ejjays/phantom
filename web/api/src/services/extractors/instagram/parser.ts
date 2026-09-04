import { load } from 'cheerio';
import { decode } from '../facebook/utils.js';
import { IgParsed, IgMedia } from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// highest pixel-count rendition wins
function bestVideo(versions: any[]): any {
  return versions.reduce((prev, next) =>
    (prev.width ?? 0) * (prev.height ?? 0) <
    (next.width ?? 0) * (next.height ?? 0)
      ? next
      : prev
  );
}

function mediaFromMobile(node: any): IgMedia | null {
  const videos = node?.video_versions;
  if (Array.isArray(videos) && videos.length > 0) {
    const best = bestVideo(videos);
    return {
      url: best.url,
      isVideo: true,
      width: best.width,
      height: best.height,
    };
  }
  const candidate = node?.image_versions2?.candidates?.[0];
  if (candidate?.url) {
    return {
      url: candidate.url,
      isVideo: false,
      width: candidate.width,
      height: candidate.height,
    };
  }
  return null;
}

function mediaFromGql(node: any): IgMedia | null {
  if (node?.video_url) {
    return {
      url: node.video_url,
      isVideo: true,
      width: node.dimensions?.width,
      height: node.dimensions?.height,
    };
  }
  if (node?.display_url) {
    return {
      url: node.display_url,
      isVideo: false,
      width: node.dimensions?.width,
      height: node.dimensions?.height,
    };
  }
  return null;
}

// single or carousel: mobile items[0], gql shortcode_media
export function parseMobileItem(item: any): IgParsed | null {
  if (!item) return null;

  const carousel = item.carousel_media;
  const media: IgMedia[] = Array.isArray(carousel)
    ? (carousel.map(mediaFromMobile).filter(Boolean) as IgMedia[])
    : ([mediaFromMobile(item)].filter(Boolean) as IgMedia[]);

  if (media.length === 0) return null;

  return {
    id: item.code || item.pk || item.id || null,
    title: item.caption?.text || 'Instagram Post',
    uploader: item.user?.full_name || item.user?.username || 'Instagram User',
    thumbnail: item.image_versions2?.candidates?.[0]?.url,
    media,
  };
}

// pull video and audio from dash
function parseDashManifest(manifest: string): {
  videos: Array<{ url: string; width: number; height: number }>;
  audioUrl?: string;
} {
  const videos: Array<{ url: string; width: number; height: number }> = [];
  let audioUrl: string | undefined;
  let bestAudioBw = -1;
  for (const rep of manifest.matchAll(
    /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gu
  )) {
    const attrs = rep[1];
    const baseMatch = rep[2].match(/<BaseURL>([^<]+)<\/BaseURL>/u);
    if (!baseMatch) continue;
    const url = baseMatch[1].trim().replace(/&amp;/gu, '&');
    const width = Number(attrs.match(/\bwidth="(\d+)"/u)?.[1] ?? 0);
    const height = Number(attrs.match(/\bheight="(\d+)"/u)?.[1] ?? 0);
    const isAudio = /mimeType="audio/u.test(attrs) || (!width && !height);
    if (isAudio) {
      const bandwidth = Number(attrs.match(/\bbandwidth="(\d+)"/u)?.[1] ?? 0);
      if (bandwidth > bestAudioBw) {
        bestAudioBw = bandwidth;
        audioUrl = url;
      }
    } else if (width && height) {
      videos.push({ url, width, height });
    }
  }
  const seen = new Set<string>();
  const deduped = videos.filter((video) => {
    const key = `${video.width}x${video.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { videos: deduped, audioUrl };
}

// build quality ladder from dash manifest + progressive muxed fallback
function expandDashVariants(base: IgMedia, manifest?: string): IgMedia[] {
  if (!base.isVideo) return [base];
  const dash = manifest ? parseDashManifest(manifest) : null;
  // dash video-only needs separate audio; progressive muxed fallback safest
  if (!dash || dash.videos.length === 0 || !dash.audioUrl) return [base];

  const list: IgMedia[] = dash.videos.map((video) => {
    const short = Math.min(video.width, video.height);
    return {
      url: video.url,
      isVideo: true,
      width: video.width,
      height: video.height,
      audioUrl: dash.audioUrl,
      muxed: false,
      formatId: `${short}p`,
      quality: `${short}p`,
    };
  });

  const pShort =
    base.width && base.height ? Math.min(base.width, base.height) : 0;
  list.push({
    ...base,
    muxed: true,
    formatId: pShort ? `${pShort}p_progressive` : 'sd',
    quality: pShort ? `${pShort}p` : 'SD',
  });

  list.sort(
    (lhs, rhs) =>
      (rhs.width ?? 0) * (rhs.height ?? 0) -
      (lhs.width ?? 0) * (lhs.height ?? 0)
  );
  const seen = new Set<string>();
  return list.filter((entry) => {
    const key = entry.formatId as string;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// quality variants for single gql video (dash nested under dash_info)
function singleVideoMedia(node: any): IgMedia[] {
  const base = mediaFromGql(node);
  if (!base) return [];
  return expandDashVariants(base, node?.dash_info?.video_dash_manifest);
}

// logged-out gql shares mobile shape but dash at top level
export function parseLoggedOutProduct(product: any): IgParsed | null {
  if (!product) return null;

  const carousel = product.carousel_media;
  let media: IgMedia[];
  if (Array.isArray(carousel)) {
    media = carousel.map(mediaFromMobile).filter(Boolean) as IgMedia[];
  } else {
    const base = mediaFromMobile(product);
    media = base ? expandDashVariants(base, product.video_dash_manifest) : [];
  }
  if (media.length === 0) return null;

  return {
    id: product.code || product.pk || product.id || null,
    title: product.caption?.text || 'Instagram Post',
    uploader:
      product.user?.full_name || product.user?.username || 'Instagram User',
    thumbnail: product.image_versions2?.candidates?.[0]?.url,
    media,
  };
}

export function parseGraphqlMedia(node: any): IgParsed | null {
  if (!node) return null;

  const sidecar = node.edge_sidecar_to_children?.edges;
  const media: IgMedia[] = Array.isArray(sidecar)
    ? (sidecar
        .map((edge: any) => mediaFromGql(edge?.node))
        .filter(Boolean) as IgMedia[])
    : singleVideoMedia(node);

  if (media.length === 0) return null;

  return {
    id: node.shortcode || node.id || null,
    title:
      node.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Post',
    uploader: node.owner?.full_name || node.owner?.username || 'Instagram User',
    thumbnail: node.display_url,
    media,
  };
}

// embed bundles graphql; degraded regex for older embeds
function extractEmbedContext(html: string): any {
  try {
    const initMatch = html.match(/"init",\[\],\[(.*?)\]\],/u);
    if (!initMatch) return null;
    const init = JSON.parse(initMatch[1]);
    if (!init?.contextJSON) return null;
    const ctx = JSON.parse(init.contextJSON);
    return (
      ctx?.gql_data?.shortcode_media ||
      ctx?.gql_data?.xdt_shortcode_media ||
      null
    );
  } catch {
    return null;
  }
}

export function parseEmbed(html: string): IgParsed | null {
  const ctx = extractEmbedContext(html);
  if (ctx) {
    const structured = parseGraphqlMedia(ctx);
    if (structured) return structured;
  }

  const videoMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/u);
  const url = videoMatch ? decode(videoMatch[1]) : null;
  if (!url) return null;

  const page = load(html);
  return {
    id: null,
    title:
      page('meta[property="og:title"]').attr('content') ||
      page('.Caption').text() ||
      'Instagram Video',
    uploader: page('.Username').text() || 'Instagram User',
    thumbnail: page('meta[property="og:image"]').attr('content'),
    media: [{ url, isVideo: true }],
  };
}
