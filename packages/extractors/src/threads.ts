import { Format, VideoInfo, ExtractorOptions } from './shared/types.js';
import { ExtractorEnv, defaultEnv } from './shared/env.js';
import { DESKTOP_UA } from './shared/util.js';
import { buildPageHeaders } from './shared/headers.js';
import { noVideo, classifyThrown } from './shared/errors.js';
import { parseHtml } from './threads/parser.js';
import { normalizeVideoInfo } from './threads/normalizer.js';

const STREAM_REFERER = 'https://www.threads.com/';
const HEADERS = buildPageHeaders(DESKTOP_UA);

function buildEmbedUrl(url: string): string {
  const clean = url.split('?')[0].replace(/\/+$/u, '');
  return `${clean}/embed`;
}

async function fetchPage(
  env: ExtractorEnv,
  target: string,
  options: ExtractorOptions
): Promise<{ html: string; targetUrl: string } | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const res = await env.fetch(target, {
    headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (!res.ok) return null;
  const targetUrl = (res as unknown as { url?: string }).url || target;
  return { html: await res.text(), targetUrl };
}

async function fetchFileSize(env: ExtractorEnv, url: string): Promise<number | undefined> {
  try {
    const res = await env.fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': DESKTOP_UA },
    });
    if (!res.ok) return undefined;
    const len = res.headers.get('content-length');
    return len ? parseInt(len, 10) : undefined;
  } catch {
    return undefined;
  }
}

export function createThreadsExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
    try {
      const primary = await fetchPage(env, url, options);
      let videoInfo = primary ? normalizeVideoInfo(primary.targetUrl, parseHtml(primary.html, primary.targetUrl)) : null;

      if (!videoInfo || videoInfo.formats.length === 0) {
        const embed = await fetchPage(env, buildEmbedUrl(url), options);
        const alt = embed ? normalizeVideoInfo(embed.targetUrl, parseHtml(embed.html, embed.targetUrl)) : null;
        if (alt && alt.formats.length > 0) videoInfo = alt;
      }

      if (!videoInfo || videoInfo.formats.length === 0) throw noVideo('Threads');

      for (let i = 0; i < videoInfo.formats.length; i += 3) {
        const batch = videoInfo.formats.slice(i, i + 3);
        await Promise.all(
          batch.map(async (format: Format) => {
            if (!format.url || format.filesize) return;
            const size = await fetchFileSize(env, format.url);
            if (size) format.filesize = size;
          })
        );
      }

      return videoInfo;
    } catch (error: unknown) {
      throw classifyThrown(error, 'Threads');
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const sel =
      videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!sel?.url) throw new Error('No stream URL found');
    return env.streamUrl(sel.url, {
      'User-Agent': DESKTOP_UA,
      Referer: STREAM_REFERER,
      Origin: 'https://www.threads.com',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Range: 'bytes=0-',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    });
  }

  return { getInfo, getStream };
}
