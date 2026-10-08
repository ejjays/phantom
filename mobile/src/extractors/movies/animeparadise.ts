import {
  hlsVariantsToFormats,
  parseHlsMaster,
  type Format,
} from '@phantom/extractors';
import { fetchWithTimeout } from '../../lib/net';
import { DESKTOP_UA } from '../../lib/userAgents';
import type { MovieRef } from './parse';
import { log } from '../../lib/log';

const PARADISE_API = 'https://api.animeparadise.moe';
const PARADISE_STREAM = 'https://stream.animeparadise.moe';
const PARADISE_ORIGIN = 'https://animeparadise.moe';
const FETCH_TIMEOUT_MS = 8000;

export function paradiseHeaders(): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Referer: `${PARADISE_ORIGIN}/`,
    Origin: PARADISE_ORIGIN,
  };
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

async function getJson(path: string): Promise<unknown> {
  try {
    const res = await fetchWithTimeout(
      `${PARADISE_API}${path}`,
      { headers: paradiseHeaders() },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

type ParadiseShow = { id: string; link: string };

async function findShow(title: string): Promise<ParadiseShow | null> {
  const data = rec(await getJson(`/search?q=${encodeURIComponent(title)}&limit=20`));
  const raw = data?.['data'];
  if (!Array.isArray(raw)) return null;
  const want = normTitle(title);
  for (const entry of raw) {
    const item = rec(entry);
    const name = str(item?.['title']);
    const id = str(item?.['_id']);
    const link = str(item?.['link']);
    if (!name || !id || !link) continue;
    if (normTitle(name) !== want) continue;
    const detail = rec(await getJson(`/anime/${link}`));
    if (rec(detail?.['data'])?.['type'] !== 'TV') continue;
    return { id, link };
  }
  return null;
}

type ParadiseEpisode = { uid: string };

async function findEpisode(showId: string, episode: string): Promise<ParadiseEpisode | null> {
  const data = rec(await getJson(`/anime/${showId}/episode`));
  const raw = data?.['data'];
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    const ep = rec(entry);
    const number = ep?.['number'];
    const uid = str(ep?.['uid']);
    if (!uid) continue;
    if (String(number ?? '') === episode) return { uid };
  }
  return null;
}

async function resolveStreamLink(showId: string, uid: string): Promise<string | null> {
  const data = rec(await getJson(`/ep/${uid}?origin=${showId}`));
  const link = str(rec(rec(data?.['data'])?.['episode'])?.['streamLink']);
  return link;
}

function autoFormat(masterUrl: string): Format {
  return {
    formatId: 'paradise-auto',
    url: masterUrl,
    extension: 'mp4',
    quality: 'Auto',
    vcodec: 'h264',
    acodec: 'aac',
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    isHls: true,
    hlsKeepAlive: true,
    note: 'paradise auto',
  };
}

export async function fetchParadiseFormats(
  ref: MovieRef,
  title: string
): Promise<{ formats: Format[]; headers: Record<string, string> } | null> {
  if (ref.kind !== 'tv' || ref.season !== '1' || !str(title)) return null;
  const started = Date.now();
  const show = await findShow(title);
  if (!show) return null;
  const ep = await findEpisode(show.id, ref.episode);
  if (!ep) return null;
  const streamLink = await resolveStreamLink(show.id, ep.uid);
  if (!streamLink) return null;
  const masterUrl = `${PARADISE_STREAM}/m3u8?url=${encodeURIComponent(streamLink)}`;
  let manifest: string | null = null;
  try {
    const res = await fetchWithTimeout(
      masterUrl,
      { headers: paradiseHeaders() },
      FETCH_TIMEOUT_MS
    );
    if (res.ok) {
      const text = await res.text();
      if (text.includes('#EXTM3U')) manifest = text;
    }
  } catch {
    manifest = null;
  }
  if (!manifest) return null;
  const variants = hlsVariantsToFormats(parseHlsMaster(manifest, masterUrl), {
    durationSec: 0,
  });
  const formats: Format[] = [
    autoFormat(masterUrl),
    ...variants.map((variant) => ({
      ...variant,
      formatId: `paradise-${(variant.quality ?? 'src').toLowerCase()}`,
      hlsKeepAlive: true,
      note: 'paradise',
    })),
  ];
  log(
    'Movies',
    `paradise tv/${ref.tmdbId}/${ref.season}/${ref.episode} formats=${formats.length} ms=${Date.now() - started}`
  );
  return { formats, headers: paradiseHeaders() };
}
