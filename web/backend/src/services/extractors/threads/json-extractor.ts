// json-block walk; regex/og stays as fallback
import { ThreadsRawFormat, ThreadsParsed } from './types.js';

type Obj = Record<string, unknown>;

// no id here; parser adds it
type ThreadsJsonResult = Omit<ThreadsParsed, 'id'>;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

function walk(node: unknown, visit: (obj: Obj) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node as Obj);
  for (const value of Object.values(node)) walk(value, visit);
}

// highest-resolution: versions entry / image candidate
function bestVideo(
  versions: unknown
): { url: string; width?: number; height?: number } | null {
  if (!Array.isArray(versions)) return null;
  let best: { url: string; width?: number; height?: number } | null = null;
  for (const entry of versions) {
    if (!entry || typeof entry !== 'object') continue;
    const url = str((entry as Obj).url);
    if (!url) continue;
    const width = num((entry as Obj).width);
    if (!best || (width ?? 0) > (best.width ?? 0)) {
      best = { url, width, height: num((entry as Obj).height) };
    }
  }
  return best;
}

function bestImage(imageVersions: unknown): string | undefined {
  if (!imageVersions || typeof imageVersions !== 'object') return undefined;
  const candidates = (imageVersions as Obj).candidates;
  if (!Array.isArray(candidates)) return undefined;
  let best: { url: string; width: number } | undefined;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const url = str((candidate as Obj).url);
    const width = num((candidate as Obj).width) ?? 0;
    if (url && (!best || width > best.width)) best = { url, width };
  }
  return best?.url;
}

function captionText(value: unknown): string | undefined {
  if (value && typeof value === 'object') return str((value as Obj).text);
  return str(value);
}

// pull uri from {image:{uri}} or {uri} node
function nestedUri(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const node = value as Obj;
  const image = node.image as Obj | undefined;
  return str(image?.uri) ?? str(node.uri);
}

export function extractFromJson(html: string): ThreadsJsonResult | null {
  const blocks = html.matchAll(
    /<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gu
  );

  const formats: ThreadsRawFormat[] = [];
  const seen = new Set<string>();
  const photos: string[] = [];
  let title = '';
  let uploader = '';
  let thumbnail = '';

  const addVideo = (
    url: string | undefined,
    id: string,
    width?: number,
    height?: number
  ) => {
    if (!url || seen.has(url)) return;
    if (formats.some((format) => format.format_id === id)) return;
    seen.add(url);
    formats.push({
      url,
      format_id: id,
      ext: 'mp4',
      vcodec: 'h264',
      acodec: 'aac',
      width,
      height,
    });
  };

  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    walk(data, (obj) => {
      // ig/threads adaptive media
      const video = bestVideo(obj.video_versions);
      if (video) addVideo(video.url, 'hd', video.width, video.height);

      // fb-style direct urls; dims co-located on node
      const dimW = num(obj.original_width);
      const dimH = num(obj.original_height);
      addVideo(
        str(obj.browser_native_hd_url) ?? str(obj.playable_url_quality_hd),
        'hd',
        dimW,
        dimH
      );
      addVideo(
        str(obj.browser_native_sd_url) ?? str(obj.playable_url),
        'sd',
        dimW,
        dimH
      );

      if (!title) title = captionText(obj.caption) ?? str(obj.title) ?? '';
      if (!uploader) {
        const user = obj.user as Obj | undefined;
        uploader =
          str(user?.full_name) ??
          str(user?.username) ??
          str(obj.username) ??
          '';
      }
      const image = bestImage(obj.image_versions2);
      if (image) {
        if (!thumbnail) thumbnail = image;
        if (!photos.includes(image)) photos.push(image);
      }
      // fb-style poster for video posts
      if (!thumbnail) {
        thumbnail =
          nestedUri(obj.preferred_thumbnail) ??
          str(obj.thumbnail_url) ??
          str(obj.cover_photo_url) ??
          '';
      }
    });
  }

  // image post: no video found, use candidates
  if (formats.length === 0 && photos.length > 0) {
    const single = photos.length === 1;
    photos.forEach((url, index) => {
      formats.push({
        url,
        format_id: single ? 'photo' : `photo_${index}`,
        ext: 'jpeg',
      });
    });
  }

  if (formats.length === 0) return null;
  return { formats, title, uploader, thumbnail };
}
