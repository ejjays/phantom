import { ID_REGEX } from './constants.js';
import { decode, decodeHtmlEntities } from '../facebook/utils.js';
import { extractFromJson } from './json-extractor.js';
import { ThreadsRawFormat, ThreadsParsed } from './types.js';

function matchContent(html: string, property: string): string | undefined {
  const pattern = new RegExp(
    `<meta property="${property}" content="([^"]*)"`,
    'u'
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

function parseOgVideo(html: string): string | undefined {
  return (
    matchContent(html, 'og:video:secure_url') ??
    matchContent(html, 'og:video:url') ??
    matchContent(html, 'og:video')
  );
}

function parseOgAuthor(html: string): string | undefined {
  const title = matchContent(html, 'og:title');
  if (!title) return undefined;
  const handle = title.match(/\(@([A-Za-z0-9_.]+)\)/u);
  if (handle) return handle[1];
  return title.replace(/ on Threads/iu, '').trim() || undefined;
}

export function parseHtml(html: string, url: string): ThreadsParsed {
  const idMatch = url.match(ID_REGEX);
  const code = idMatch ? idMatch[1] : null;
  const ogCaption = matchContent(html, 'og:description');
  const ogImage = matchContent(html, 'og:image');
  const ogAuthor = parseOgAuthor(html);

  const json = extractFromJson(html);
  if (json) {
    return {
      id: code,
      title: json.title || ogCaption || '',
      uploader: json.uploader || ogAuthor || '',
      thumbnail: json.thumbnail || ogImage || '',
      formats: json.formats,
    };
  }

  const formats: ThreadsRawFormat[] = [];
  const ogVideo = parseOgVideo(html);
  if (ogVideo)
    formats.push({ url: decode(ogVideo), format_id: 'hd', ext: 'mp4' });

  if (formats.length === 0 && ogImage) {
    formats.push({ url: ogImage, format_id: 'photo', ext: 'jpeg' });
  }

  return {
    id: code,
    title: ogCaption || '',
    uploader: ogAuthor || '',
    thumbnail: ogImage || '',
    formats,
  };
}
