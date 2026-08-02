import { Innertube } from 'youtubei.js';
import { logger } from '../../../utils/infra/logger.util.js';
import { BG } from 'bgutils-js';
import { JSDOM } from 'jsdom';

/*
* poToken generation. without it youtube serves SABR-only (no stream urls);
* with it ANDROID_VR returns real urls. token is bound to visitorData and
* lives few hours, so generate once & cache.
*/

// well-known youtube web botguard request key
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface PoTokenBundle {
  poToken: string;
  visitorData: string;
  expiresAt: number;
}

let cached: PoTokenBundle | null = null;
let inflight: Promise<PoTokenBundle | null> | null = null;
let domReady = false;

// botguard's vm needs browser globals
function ensureDom(): void {
  if (domReady) return;
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://www.youtube.com/',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });
  domReady = true;
}

async function fetchVisitorData(): Promise<string> {
  const bootstrap = await Innertube.create({ retrieve_player: false });
  const visitorData = bootstrap.session.context.client.visitorData;
  if (!visitorData) throw new Error('no visitorData from bootstrap session');
  return visitorData;
}

async function generate(): Promise<PoTokenBundle | null> {
  try {
    const visitorData = await fetchVisitorData();
    ensureDom();

    const bgConfig = {
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
      globalObj: globalThis as unknown as Record<string, unknown>,
      identifier: visitorData,
      requestKey: REQUEST_KEY,
    } as Parameters<typeof BG.Challenge.create>[0];

    const challenge = await BG.Challenge.create(bgConfig);
    if (!challenge) throw new Error('challenge creation returned nothing');

    const script =
      challenge.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!script) throw new Error('challenge missing interpreter script');

    // eslint-disable-next-line sonarjs/code-eval -- trusted botguard payload
    new Function(script)();

    const result = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig,
    });

    const ttlSecs = result.integrityTokenData?.estimatedTtlSecs;
    const ttlMs = ttlSecs ? ttlSecs * 1000 : DEFAULT_TTL_MS;
    const bundle: PoTokenBundle = {
      poToken: result.poToken,
      visitorData,
      expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000),
    };
    cached = bundle;
    logger.info(
      `[poToken] generated (len=${bundle.poToken.length}, ttl=${Math.round(
        (bundle.expiresAt - Date.now()) / 1000
      )}s)`
    );
    return bundle;
  } catch (err) {
    logger.warn('[poToken] generation failed:', (err as Error).message);
    return null;
  }
}

/* 
* cached token; regenerates on expiry,
* one in-flight gen at a time, null on failure
*/

export function getPoToken(
  forceRefresh = false
): Promise<PoTokenBundle | null> {
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return Promise.resolve(cached);
  }
  if (inflight) return inflight;
  inflight = generate().finally(() => {
    inflight = null;
  });
  return inflight;
}
