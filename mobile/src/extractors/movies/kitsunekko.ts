import { fetchWithTimeout } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import type { SubtitleTrack } from '../../lib/subtitles';
import { log } from '../../lib/log';

const KITSU_BASE = 'https://kitsunekko.net';
const FETCH_TIMEOUT_MS = 10000;

type Folder = { dir: string; name: string };

let folderCache: Folder[] | null = null;

function normTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function episodeRe(episode: string): RegExp | null {
  if (!/^\d+$/u.test(episode)) return null;
  const num = String(Number(episode));
  return new RegExp(
    `(?:^|[\\s._\\-(\\[])(?:s\\d+e|e|ep)?0*${num}(?![0-9])`,
    'iu'
  );
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': DESKTOP_UA, Referer: `${KITSU_BASE}/` } },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function folderIndex(): Promise<Folder[]> {
  if (folderCache) return folderCache;
  const html = await getText(`${KITSU_BASE}/dirlist.php?dir=subtitles%2F`);
  if (!html) return [];
  const out: Folder[] = [];
  const re =
    /<a href="(\/dirlist\.php\?dir=subtitles%2F[^"]+)"[^>]*><strong>([^<]*)</giu;
  for (const match of html.matchAll(re)) {
    const dir = match[1] ?? '';
    const name = (match[2] ?? '').trim();
    if (dir && name) out.push({ dir, name });
  }
  folderCache = out;
  return out;
}

export async function fetchKitsunekkoSubtitles(
  title: string,
  episode: string
): Promise<SubtitleTrack[]> {
  const started = Date.now();
  const matcher = episodeRe(episode);
  if (!matcher) return [];
  log('Subtitles', `kitsunekko lookup "${title}" ep ${episode}`);
  const folders = await folderIndex();
  const want = normTitle(title);
  const folder = folders.find((entry) => normTitle(entry.name) === want);
  if (!folder) {
    log(
      'Subtitles',
      `kitsunekko no folder for "${title}" (${folders.length} indexed)`
    );
    return [];
  }
  const html = await getText(`${KITSU_BASE}${folder.dir}`);
  if (!html) {
    log('Subtitles', `kitsunekko folder unreadable for "${title}"`);
    return [];
  }
  const out: SubtitleTrack[] = [];
  const seen = new Set<string>();
  const re = /<a href="(subtitles\/[^"]+?)"[^>]*>/giu;
  for (const match of html.matchAll(re)) {
    const href = match[1] ?? '';
    if (!/\.srt(?:[?#]|$)/iu.test(href)) continue;
    const base = href.split('/').pop() ?? href;
    if (!matcher.test(base)) continue;
    let url: string | null = null;
    try {
      url = new URL(href, `${KITSU_BASE}/`).href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ label: 'English', lang: 'en', url });
    if (out.length >= 3) break;
  }
  if (out.length === 0) {
    log('Subtitles', `kitsunekko no file for "${title}" ep ${episode}`);
  }
  if (out.length > 0) {
    log(
      'Subtitles',
      `kitsunekko "${title}" ep ${episode} tracks=${out.length} ms=${Date.now() - started}`
    );
  }
  return out;
}
