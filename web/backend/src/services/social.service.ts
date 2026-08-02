import { downloadImageToBuffer } from './ytdlp.service.js';
import { logger } from '../utils/infra/logger.util.js';
import type { RawSocialData } from '@phantom/extractors/social';

export { normalizeTitle, normalizeArtist } from '@phantom/extractors/social';

export const getBestThumbnail = (info: RawSocialData): string | undefined => {
  if (typeof info !== 'object' || info === null) {
    return undefined;
  }

  // metascraper image, unless it's an emoji/svg
  const metaImg = info.metascraper?.image as string | undefined;
  if (metaImg && !/\/emoji\/|\.svg(?:$|\?)/iu.test(metaImg)) return metaImg;

  let finalThumbnail = info.thumbnail;
  const thumbnails = info.thumbnails;
  if (!finalThumbnail && Array.isArray(thumbnails) && thumbnails.length > 0) {
    const best = thumbnails.reduce((prev, current) => {
      const prevWidth = prev.width ?? 0;
      const currWidth = current.width ?? 0;
      return prevWidth > currWidth ? prev : current;
    });
    finalThumbnail = best.url;
  }
  return finalThumbnail;
};

export const proxyThumbnailIfNeeded = async (
  thumbnailUrl: string | undefined,
  videoUrl: string
): Promise<string | undefined> => {
  if (!thumbnailUrl || thumbnailUrl.startsWith('data:')) return thumbnailUrl;

  const isPermanentDomain =
    thumbnailUrl.includes('i.scdn.co') ||
    thumbnailUrl.includes('spotifycdn.com') ||
    thumbnailUrl.includes('ytimg.com') ||
    thumbnailUrl.includes('googleusercontent.com') ||
    thumbnailUrl.includes('ggpht.com');

  if (isPermanentDomain) {
    return thumbnailUrl;
  }

  const needsProxy =
    videoUrl.includes('instagram.com') ||
    videoUrl.includes('facebook.com') ||
    videoUrl.includes('tiktok.com') ||
    videoUrl.includes('twitter.com') ||
    videoUrl.includes('bsky.app') ||
    /\/\/(?:www\.|mobile\.)?x\.com\//u.test(videoUrl);

  if (needsProxy) {
    try {
      const imgBuffer = await downloadImageToBuffer(thumbnailUrl);
      const base64Img = imgBuffer.toString('base64');
      const extension = thumbnailUrl.split('.').pop()?.split('?')[0] || 'jpeg';
      const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

      logger.info(
        `[Proxy] Volatile platform detected. Storing as Base64 (${mimeType})`
      );
      return `data:${mimeType};base64,${base64Img}`;
    } catch (error: unknown) {
      const errorObj = error as Error;
      logger.warn('[Proxy] Failed to proxy thumbnail:', errorObj.message);
      return thumbnailUrl;
    }
  }
  return thumbnailUrl;
};
