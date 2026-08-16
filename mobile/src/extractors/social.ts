import { gatedFetch, timeoutSignal } from '../lib/net';

/**
 * html entity decode for scraped pages; matches the entity set social
 * platforms actually emit (&amp; &lt; &gt; &quot; &apos; + numeric).
 * duplicated in 3 extractors historically — single source now.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (entity, code: string) => {
      if (code.startsWith('#x')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(parseInt(code.slice(1), 10));
      }
      switch (code.toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        default:
          return "'";
      }
    }
  );
}

// HEAD the media url for its size; referer+cookies sent because tokenized CDNs
// 403 bare requests. fail-soft: picker just shows no size.
export async function probeFileSize(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5000
): Promise<number | undefined> {
  try {
    const head = await gatedFetch(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: timeoutSignal(timeoutMs),
    });
    if (!head.ok) return undefined;
    const length = head.headers.get('content-length');
    return length ? parseInt(length, 10) : undefined;
  } catch {
    return undefined;
  }
}

export {
  normalizeArtist,
  normalizeTitle,
  type RawSocialData,
} from '@phantom/extractors/social';
