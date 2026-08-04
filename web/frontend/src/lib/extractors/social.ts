// local social metadata normalization (client-side, no backend dependency)
// port of @phantom/extractors/social.ts — only the helpers we use

export interface RawSocialData {
  title?: string;
  uploader?: string;
  artist?: string;
  channel?: string;
  creator?: string;
  alt_title?: string;
  description?: string;
  webpageUrl?: string;
  id?: string;
  thumbnail?: string;
  [key: string]: unknown;
}

const GENERIC_NAMES = new Set([
  'instagram',
  'facebook',
  'twitter',
  'x',
  'tiktok',
  'threads',
  'reddit',
  'youtube',
  'youtu',
  'vimeo',
  'dailymotion',
  'video',
  'reel',
  'post',
]);

function isGenericName(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  return GENERIC_NAMES.has(lower);
}

export function normalizeArtist(info: RawSocialData): string {
  const candidates = [
    info.uploader,
    info.artist,
    info.channel,
    info.creator,
    info.title,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

  for (const candidate of candidates) {
    if (!isGenericName(candidate) && candidate.trim().length > 2) {
      // strip known prefixes like "Video by", "Reel by"
      const cleaned = candidate.replace(/^(?:video|reel)\s+by\s+/iu, '').trim();
      if (cleaned && !isGenericName(cleaned)) return cleaned;
    }
  }
  return '';
}
