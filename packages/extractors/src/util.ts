// shared across platforms; small enough to live alongside the env contract.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const DESKTOP_UA = UA;
export const VIMEO_REFERER = 'https://vimeo.com/';

// regex shared by twitter.com + x.com dispatch; also used for t.co stripping
export const TCO_URL_RE = /https:\/\/t\.co\/\S{1,500}/u;

// sum #EXTINF segments (hls runtime) — small enough that a single shared util
// beats three copies drifting out of sync.
export function hlsDurationSec(playlist: string): number {
  let total = 0;
  for (const match of playlist.matchAll(/#EXTINF:([\d.]+)/gu)) {
    total += Number(match[1]);
  }
  return Number.isFinite(total) ? total : 0;
}

// bandwith (bits/s) * duration (s) / 8 -> bytes
export function estimateSize(
  bandwidth: number | undefined,
  durationSec: number
): number | undefined {
  if (!bandwidth || !durationSec) return undefined;
  return Math.round((bandwidth / 8) * durationSec);
}

// filter normalized urls (mobile uses protocol-relative etc.) to absolute
export function normalizeUrl(
  href: string,
  base: string
): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}