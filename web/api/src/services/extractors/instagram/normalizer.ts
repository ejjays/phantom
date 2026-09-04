import { VideoInfo, Format } from '../../../types/index.js';
import { normalizeTitle, normalizeArtist } from '../../social.service.js';
import { IgParsed, IgMedia } from './types.js';

function toFormat(media: IgMedia, index: number, total: number): Format {
  const dims =
    media.width && media.height ? `${media.width}x${media.height}` : undefined;
  // label carousel children for the picker
  const prefix = total > 1 ? `item${index + 1}_` : '';

  if (media.isVideo) {
    // dash variants ship video-only with separate audio
    const muxed = media.muxed !== false;
    return {
      formatId: media.formatId ?? `${prefix}hd`,
      url: media.url,
      extension: 'mp4',
      resolution: dims ?? 'Source',
      quality: media.quality ?? (total > 1 ? `Item ${index + 1}` : 'HD'),
      width: media.width,
      height: media.height,
      vcodec: 'h264',
      acodec: 'aac',
      audioUrl: media.audioUrl,
      isMuxed: muxed,
      isVideo: true,
      isAudio: muxed,
    };
  }

  return {
    formatId: media.formatId ?? `${prefix}photo`,
    url: media.url,
    extension: 'jpg',
    resolution: dims ?? 'Photo',
    quality: media.quality ?? (total > 1 ? `Item ${index + 1}` : 'Photo'),
    width: media.width,
    height: media.height,
    vcodec: 'none',
    isMuxed: false,
    isVideo: false,
    isAudio: false,
  };
}

export function normalizeVideoInfo(
  url: string,
  parsedData: IgParsed | null
): VideoInfo | null {
  if (!parsedData) return null;

  const total = parsedData.media.length;
  const formats: Format[] = parsedData.media.map((media, index) =>
    toFormat(media, index, total)
  );
  if (formats.length === 0) return null;

  const info: VideoInfo = {
    type: 'video',
    id: parsedData.id || url,
    title: parsedData.title || 'Instagram Video',
    uploader: parsedData.uploader || 'Instagram User',
    webpageUrl: url,
    thumbnail: parsedData.thumbnail,
    formats,
    extractorKey: 'instagram',
    isJsInfo: true,
    fromBrain: false,
    isPartial: false,
    isIsrcMatch: false,
    isFullData: true,
  };

  // make caption authoritative over og:title
  if (parsedData.title) {
    info.metascraper = { title: parsedData.title };
  }

  info.title = normalizeTitle(info as unknown as Record<string, unknown>);
  info.uploader = normalizeArtist(info as unknown as Record<string, unknown>);

  return info;
}
