import {
  ID_REGEX,
  THUMB_PATTERNS,
  DASH_PATTERNS,
  RECOVERY_PATTERNS,
  STORY_PATTERNS,
  PHOTO_PATTERNS,
  HD_FALLBACK_PATTERNS,
  SD_FALLBACK_PATTERNS,
} from './constants.js';
import { decode, decodeHtmlEntities } from './utils.js';
import { extractFromJson } from './json-extractor.js';
import { FbRawFormat, FbParsed } from './types.js';

function firstCapture(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }
  return null;
}

function extractMeta(html: string): { title: string; uploader: string } {
  let title = '';
  let uploader = '';
  for (const recovery of RECOVERY_PATTERNS) {
    const match = html.match(recovery.pattern);
    if (!match) continue;
    if (recovery.type === 'title' && !title) title = decode(match[1]);
    if (recovery.type === 'author' && !uploader) uploader = decode(match[1]);
  }
  return { title, uploader };
}

function extractDashFormats(html: string): FbRawFormat[] {
  const formats: FbRawFormat[] = [];
  for (const pattern of DASH_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      if (match[1] && match[2]) {
        formats.push({ url: decode(match[1]), format_id: 'hd', ext: 'mp4' });
        formats.push({
          url: decode(match[2]),
          format_id: 'audio',
          ext: 'm4a',
          acodec: 'aac',
        });
      } else if (match[1]) {
        formats.push({ url: decode(match[1]), format_id: 'sd', ext: 'mp4' });
      }
    }
  }
  return formats;
}

function extractFallbackFormats(html: string): FbRawFormat[] {
  const formats: FbRawFormat[] = [];
  const hd =
    firstCapture(html, HD_FALLBACK_PATTERNS) ??
    firstCapture(html, STORY_PATTERNS);
  if (hd) formats.push({ url: hd, format_id: 'hd', ext: 'mp4' });

  const sd = firstCapture(html, SD_FALLBACK_PATTERNS);
  if (sd) formats.push({ url: sd, format_id: 'sd', ext: 'mp4' });

  if (formats.length === 0) {
    const photo = firstCapture(html, PHOTO_PATTERNS);
    if (photo) formats.push({ url: photo, format_id: 'photo', ext: 'jpeg' });
  }
  return formats;
}

function parseOgTitle(html: string): { caption?: string; author?: string } {
  const match = html.match(/<meta property="og:title" content="([^"]*)"/u);
  if (!match) return {};
  const parts = decodeHtmlEntities(match[1])
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  const author = parts[parts.length - 1].replace(
    /^(?:Reel|Video)\s+by\s+/iu,
    ''
  );
  const caption = parts
    .slice(0, -1)
    .find(
      (part) =>
        !/\b(?:views?|reactions?|likes?|shares?|comments?)\b/iu.test(part)
    );
  return { caption, author };
}

function parseOgImage(html: string): string | undefined {
  const match = html.match(/<meta property="og:image" content="([^"]+)"/u);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

function isAltText(text: string): boolean {
  return /^May be a/iu.test(text) || /^No photo description/iu.test(text);
}

// url shapes that promise a video — poster-only results are a failure there
const VIDEO_URL_RE = /(?:share\/[vr]|\/videos?\/|\/reel|\/watch\/|fb\.watch)/iu;

function parseOgDescription(html: string): string {
  const match = html.match(
    /<meta property="og:description" content="([^"]*)"/u
  );
  if (!match) return '';
  const text = decodeHtmlEntities(match[1]).trim();
  if (isAltText(text)) return '';
  if (text.length <= 120) return text;
  const truncated = text.slice(0, 120);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

export function parseHtml(html: string, url: string): FbParsed {
  const idMatch = url.match(ID_REGEX);
  const videoId = idMatch ? idMatch[1] : null;
  const og = parseOgTitle(html);
  const ogDesc = parseOgDescription(html);

  const json = extractFromJson(html);
  if (json) {
    const meta = extractMeta(html);
    return {
      id: videoId,
      title:
        json.title ||
        og.caption ||
        ogDesc ||
        (isAltText(meta.title) ? '' : meta.title),
      uploader: json.uploader || og.author || meta.uploader,
      thumbnail: json.thumbnail || firstCapture(html, THUMB_PATTERNS) || '',
      formats: json.formats,
    };
  }

  const { title, uploader } = extractMeta(html);
  const thumbnail = firstCapture(html, THUMB_PATTERNS) ?? '';

  let formats = extractDashFormats(html);
  if (formats.length === 0) formats = extractFallbackFormats(html);

  // video-kind urls must never degrade to a poster download — the login wall
  // serves og:image with no streams, and empty formats surface as no-video
  if (VIDEO_URL_RE.test(url)) {
    formats = formats.filter((format) => format.format_id !== 'photo');
  }

  if (formats.length === 0 && !VIDEO_URL_RE.test(url)) {
    const ogImage = parseOgImage(html);
    if (ogImage) formats = [{ url: ogImage, format_id: 'photo', ext: 'jpeg' }];
  }

  return {
    id: videoId,
    title: og.caption || ogDesc || (isAltText(title) ? '' : title) || '',
    uploader: uploader || og.author || '',
    thumbnail,
    formats,
  };
}
