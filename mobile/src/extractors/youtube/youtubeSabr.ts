/*
 * sabr path — parked wip.
 * proven: runs in hermes; cookieless config ok; no cors via rn fetch.
 * blocker: media 403 (empty ump) = request shape, not auth.
 * dormant: lazy-loaded; SABR_TEST off.
 */
import '../../lib/download/webPolyfills';
import { ReadableStream as PonyReadableStream } from 'web-streams-polyfill';
import { SabrStream } from 'googlevideo/sabr-stream';
import type { FetchFunction } from 'googlevideo/shared-types';
import { YT_INTERNAL_UA } from '../../lib/userAgents';
import { log, warn as logWarn } from '../../lib/log';

// hermes lacks web streams; googlevideo's SabrStream needs them
const globals = globalThis as unknown as { ReadableStream?: unknown };
if (!globals.ReadableStream) globals.ReadableStream = PonyReadableStream;

export interface SabrFormatLite {
  itag: number;
  lastModified: string;
  xtags?: string;
  width?: number;
  height?: number;
  contentLength?: number;
  mimeType?: string;
  bitrate: number;
  averageBitrate?: number;
  approxDurationMs: number;
  audioQuality?: string;
  qualityLabel?: string;
  quality?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

export interface SabrConfig {
  serverAbrStreamingUrl: string;
  ustreamerConfig: string;
  poToken: string;
  durationMs: number;
  clientVersion?: string;
  gl?: string;
  formats: SabrFormatLite[];
}

type StreamFetch = (input: string, init?: RequestInit) => Promise<Response>;

const SABR_UA = YT_INTERNAL_UA;

// rn fetch cant stream response bodies; buffer then wrap for googlevideo.
// web ua/origin required or the cdn 403s
const bufferingFetch: StreamFetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', SABR_UA);
  headers.set('Origin', 'https://www.youtube.com');
  headers.set('Referer', 'https://www.youtube.com/');
  const res = await fetch(input, { ...init, headers });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    logWarn(
      'youtubeSabr',
      `[sabr-rn] req ${res.status} ct=${res.headers.get('content-type')} len=${buf.length}`
    );
  }
  const body = new PonyReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    body,
  } as unknown as Response;
};

function buildStream(config: SabrConfig): SabrStream {
  const clientInfo = {
    clientName: 1,
    clientVersion: config.clientVersion || '2.0',
    osName: 'Windows',
    osVersion: '10.0',
    acceptLanguage: 'en',
    acceptRegion: config.gl || 'US',
  };
  return new SabrStream({
    fetch: bufferingFetch as unknown as FetchFunction,
    serverAbrStreamingUrl: config.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: config.ustreamerConfig,
    clientInfo,
    poToken: config.poToken,
    durationMs: config.durationMs,
    formats: config.formats,
  });
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  cap: number
): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.length;
    if (total >= cap) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return total;
}

// proves SabrStream runs in hermes; reads a few MB & logs
export async function sabrSelfTest(config: SabrConfig): Promise<void> {
  try {
    const vids = config.formats
      .filter((f) => f.hasVideo && !f.hasAudio)
      .sort((lhs, rhs) => (rhs.height || 0) - (lhs.height || 0));
    const auds = config.formats
      .filter((f) => f.hasAudio && !f.hasVideo)
      .sort((lhs, rhs) => (rhs.bitrate || 0) - (lhs.bitrate || 0));
    if (vids.length === 0 || auds.length === 0) {
      logWarn('youtubeSabr', '[sabr-rn] no v/a formats');
      return;
    }
    log(
      'youtubeSabr',
      `[sabr-rn] cfg poToken=${config.poToken ? config.poToken.length : 0} ustreamer=${config.ustreamerConfig ? config.ustreamerConfig.length : 0} client=${config.clientVersion || '?'}`
    );
    const stream = buildStream(config);
    const res = await stream.start({
      videoFormat: vids[vids.length - 1].itag,
      audioFormat: auds[auds.length - 1].itag,
      maxRetries: 2,
    });
    log(
      'youtubeSabr',
      `[sabr-rn] selected v=${res.selectedFormats.videoFormat.itag} a=${res.selectedFormats.audioFormat.itag}`
    );
    const [vb, ab] = await Promise.all([
      readCapped(res.videoStream, 5000000),
      readCapped(res.audioStream, 2000000),
    ]);
    log(
      'youtubeSabr',
      `[sabr-rn] bytes video=${(vb / 1e6).toFixed(1)}mb audio=${(ab / 1e6).toFixed(1)}mb`
    );
  } catch (error: unknown) {
    logWarn(
      'youtubeSabr',
      `[sabr-rn] fail: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
