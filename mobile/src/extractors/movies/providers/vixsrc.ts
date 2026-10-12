import type { Format } from '@phantom/extractors';
import { fetchWithTimeout } from '../../../lib/net';
import { DESKTOP_UA } from '../../../lib/userAgents';
import type { MovieRef } from '../parse';

const FETCH_TIMEOUT_MS = 8000;

export function vixsrcHeaders(): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://vixsrc.to/',
    Origin: 'https://vixsrc.to',
  };
}

export function vixsrcApiUrl(ref: MovieRef): string {
  return ref.kind === 'movie'
    ? `https://vixsrc.to/api/movie/${encodeURIComponent(ref.tmdbId)}`
    : `https://vixsrc.to/api/tv/${encodeURIComponent(ref.tmdbId)}/${encodeURIComponent(ref.season)}/${encodeURIComponent(ref.episode)}`;
}

export function vixsrcMasterUrl(
  pageUrl: string,
  token: string,
  expires: string
): string {
  const base = new URL(pageUrl);
  const query = base.searchParams.toString();
  const prefix = query ? `${query}&` : '';
  const auth = `token=${encodeURIComponent(token)}&expires=${encodeURIComponent(expires)}&h=1`;
  return `${base.origin}${base.pathname}.m3u8?${prefix}${auth}`;
}

async function getText(url: string): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    { headers: vixsrcHeaders() },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`vixsrc ${res.status}`);
  return res.text();
}

function parseRungs(m3u8: string): Format[] {
  const lines = m3u8.split('\n');
  const seen = new Set<string>();
  const out: Format[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const found = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const next = (lines[index + 1] ?? '').trim();
    if (!next || next.startsWith('#')) continue;
    const height = found ? Number(found[2]) : 0;
    const label =
      height > 0 ? `${height}p` : `${Math.round(bandwidth / 1000)}k`;
    const formatId = `vixsrc-${label.toLowerCase()}`;
    if (seen.has(formatId)) continue;
    seen.add(formatId);
    out.push({
      formatId,
      url: next,
      extension: 'mp4',
      quality: label,
      width: found ? Number(found[1]) : undefined,
      height: height > 0 ? height : undefined,
      vcodec: 'h264',
      acodec: 'aac',
      isMuxed: true,
      isVideo: true,
      isAudio: false,
      isHls: true,
      hlsKeepAlive: true,
      note: 'vixsrc',
    });
  }
  out.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return out;
}

export async function fetchVixsrcFormats(
  ref: MovieRef
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  const apiRaw = await getText(vixsrcApiUrl(ref));
  const src = (JSON.parse(apiRaw) as { src?: unknown }).src;
  if (typeof src !== 'string' || !src.startsWith('/embed/')) return null;

  const html = await getText(`https://vixsrc.to${src}`);
  const token = html.match(/['"]token['"]:\s?['"]([^'"]*)['"]/)?.[1];
  const expires = html.match(/['"]expires['"]:\s?['"]([^'"]*)['"]/)?.[1];
  const pageUrl = html.match(/url:\s?['"]([^'"]*)['"]/)?.[1];
  if (!token || !expires || !pageUrl) return null;

  const master = vixsrcMasterUrl(pageUrl, token, expires);
  const rungs = parseRungs(await getText(master));
  if (rungs.length === 0) return null;
  const top = rungs[0];
  return {
    formats: [
      {
        formatId: 'vixsrc-auto',
        url: master,
        extension: 'mp4',
        quality: 'Auto',
        width: top.width,
        height: top.height,
        vcodec: 'h264',
        acodec: 'aac',
        isMuxed: true,
        isVideo: true,
        isAudio: false,
        isHls: true,
        hlsKeepAlive: true,
        note: 'vixsrc',
      },
      ...rungs,
    ],
    headers: vixsrcHeaders(),
  };
}
