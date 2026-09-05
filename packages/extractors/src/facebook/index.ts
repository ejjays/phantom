import { Format, VideoInfo, ExtractorOptions } from '../shared/types.js';
import { ExtractorEnv, defaultEnv } from '../shared/env.js';
import { DESKTOP_UA } from '../shared/util.js';
import { buildPageHeaders } from '../shared/headers.js';
import { noVideo, temporaryError, classifyThrown } from '../shared/errors.js';
import { parseHtml } from './parser.js';
import { normalizeVideoInfo } from './normalizer.js';

const REFERER = 'https://www.facebook.com/';
const HEADERS = buildPageHeaders(DESKTOP_UA);

async function fetchHtml(
  env: ExtractorEnv,
  url: string,
  options: ExtractorOptions
): Promise<{ html: string; targetUrl: string } | null> {
  const cookie = typeof options.cookie === 'string' ? options.cookie : null;
  const res = await env.fetch(url, {
    headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (!res.ok) return null;
  const targetUrl = (res as unknown as { url?: string }).url || url;
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

export function createFacebookExtractor(env: ExtractorEnv = defaultEnv) {
  async function getInfo(url: string, options: ExtractorOptions = {}): Promise<VideoInfo | null> {
    try {
      const fetched = await fetchHtml(env, url, options);
      if (!fetched) throw temporaryError('Facebook');
      let videoInfo = normalizeVideoInfo(fetched.targetUrl, parseHtml(fetched.html, fetched.targetUrl));
      if (!videoInfo) throw noVideo('Facebook');

      if (videoInfo.title === videoInfo.uploader) {
        const retry = await fetchHtml(env, url, options).catch(() => null);
        const alt = retry ? normalizeVideoInfo(retry.targetUrl, parseHtml(retry.html, retry.targetUrl)) : null;
        if (alt && alt.formats.length > 0) videoInfo = alt;
      }

      try {
        options.onPartial?.({ ...videoInfo, formats: [], isPartial: true });
      } catch {
        /* paint is best-effort */
      }

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
      throw classifyThrown(error, 'Facebook');
    }
  }

  function getStream(videoInfo: VideoInfo, options: ExtractorOptions = {}): Promise<ReadableStream> {
    const sel =
      videoInfo.formats.find((f) => String(f.formatId) === String(options.formatId)) ?? videoInfo.formats[0];
    if (!sel?.url) throw new Error('No stream URL found');
    return env.streamUrl(sel.url, {
      'User-Agent': DESKTOP_UA,
      Referer: REFERER,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Range: 'bytes=0-',
      Origin: REFERER.slice(0, -1),
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    });
  }

  return { getInfo, getStream };
}
