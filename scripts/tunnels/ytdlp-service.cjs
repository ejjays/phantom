'use strict';

/**
 * residential extraction and media proxy.
 *
 * handles yt-dlp calls and googlevideo relaying
 * to bypass ip-based speed limits.
 * uses hmac for signed media access.
 */
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SECRET = process.env.YTDLP_REMOTE_SECRET || '';
const PORT = Number(process.env.YTDLP_SERVICE_PORT) || 5055;
const COOKIES = process.env.YTDLP_COOKIES_FILE || '';
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const MEDIA_CHUNK = 8 * 1024 * 1024;
const MAX_MEDIA_RETRIES = 5;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// prevent rce and credential leaks
const FORBIDDEN = new Set([
  '--exec',
  '--exec-before-download',
  '--external-downloader',
  '--external-downloader-args',
  '--batch-file',
  '-a',
  '--load-info-json',
  '--load-info',
  '--cookies-from-browser',
  '--postprocessor-args',
  '--ppa',
  '--config-locations',
]);

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ensures requests originated from backend
function verifyMediaSig(rawUrl, exp, sig, ytUrl) {
  if (!SECRET || !sig || !exp) return false;
  if (Date.now() > Number(exp)) return false;
  const payload = ytUrl ? `${rawUrl}\n${exp}\n${ytUrl}` : `${rawUrl}\n${exp}`;
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// restrict proxying to trusted domains
function isGooglevideo(rawUrl) {
  try {
    return /(^|\.)googlevideo\.com$/iu.test(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function isYoutubeUrl(url) {
  try {
    return /(^|\.)(youtube\.com|youtu\.be)$/iu.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function dubLangFromUrl(rawUrl) {
  try {
    const xtags = new URL(rawUrl).searchParams.get('xtags') || '';
    if (!/acont=dubbed/iu.test(xtags)) return null;
    const match = /lang=([\w-]+)/iu.exec(xtags);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

let dubCookiePath = null;
let dubCookieResolved = false;
// resolve cookies for gated dub audio
function resolveDubCookies() {
  if (dubCookieResolved) return dubCookiePath;
  dubCookieResolved = true;
  if (COOKIES && fs.existsSync(COOKIES)) {
    dubCookiePath = COOKIES;
    return dubCookiePath;
  }
  const header = (process.env.YT_DLP_COOKIE || '').trim();
  if (!header) return null;
  try {
    const lines = ['# Netscape HTTP Cookie File'];
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      lines.push(
        `.youtube.com\tTRUE\t/\tTRUE\t1799999999\t${trimmed.slice(0, eq)}\t${trimmed.slice(eq + 1)}`
      );
    }
    const file = `${require('node:os').tmpdir()}/relay-yt-cookies.txt`;
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    dubCookiePath = file;
    return file;
  } catch {
    return null;
  }
}

// dubbed audio is gated; pull it via yt-dlp
function streamDubAudio(ytUrl, lang, req, res) {
  const cookiePath = resolveDubCookies();
  if (!cookiePath) {
    res.writeHead(502);
    res.end('dub cookies missing');
    return;
  }
  const base = lang.split('-')[0];
  const potBase = process.env.YT_POT_BASE_URL || 'http://127.0.0.1:4416';
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--force-ipv4',
    '--no-colors',
    '--cookies',
    cookiePath,
    '--extractor-args',
    'youtube:player_client=mweb,tv,default',
    '--extractor-args',
    `youtubepot-bgutilhttp:base_url=${potBase}`,
    '-f',
    `ba[language^=${base}][ext=m4a]/ba[language^=${base}]`,
    '-o',
    '-',
    ytUrl,
  ];
  res.writeHead(200, {
    'Content-Type': 'audio/mp4',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  console.log(`[media] dub ${lang} via yt-dlp`);
  const child = spawn(YTDLP, args);
  req.on('close', () => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  child.stderr.resume();
  child.stdout.pipe(res);
  child.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded) res.end();
  });
  child.on('close', () => {
    if (!res.writableEnded) res.end();
  });
}

function parseRange(rangeHeader) {
  let start = 0;
  let end = Infinity;
  if (rangeHeader) {
    const m = /bytes=(\d+)-(\d*)/u.exec(rangeHeader);
    if (m) {
      start = Number(m[1]);
      end = m[2] ? Number(m[2]) : Infinity;
    }
  }
  return { start, end };
}

// bypasses per-connection speed limits
async function handleMedia(parsed, req, res) {
  const rawUrl = parsed.searchParams.get('u') || '';
  const exp = parsed.searchParams.get('e') || '';
  const sig = parsed.searchParams.get('s') || '';
  const ytUrl = parsed.searchParams.get('yt') || '';

  if (!verifyMediaSig(rawUrl, exp, sig, ytUrl)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!isGooglevideo(rawUrl)) {
    res.writeHead(400);
    res.end('bad target');
    return;
  }

  // gated dub audio routes through yt-dlp
  const dubLang = ytUrl && isYoutubeUrl(ytUrl) ? dubLangFromUrl(rawUrl) : null;
  if (dubLang) {
    streamDubAudio(ytUrl, dubLang, req, res);
    return;
  }

  const { start, end } = parseRange(req.headers.range);

  try {
    await relayChunks(rawUrl, start, end, req, res);
    if (!res.writableEnded) res.end();
  } catch {
    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded) res.end();
  }
}

// finalizes the response for a failed/blocked chunk.
// returns true when handled, signalling the relay loop to stop.
function writeChunkError(res, chunk) {
  if (!chunk) {
    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded) res.end();
    return true;
  }
  if (chunk.status === 403) {
    if (!res.headersSent) res.writeHead(403);
    res.end();
    return true;
  }
  return false;
}

// derives the total size from the first upstream chunk, clamps the range end,
// and writes the response head. returns the resolved { total, currentEnd }.
function initRelayResponse(req, res, chunkHeaders, start, currentEnd) {
  const cr = chunkHeaders.get('content-range');
  const match = cr ? /\/(\d+)\s*$/u.exec(cr) : null;
  const total = match
    ? Number(match[1])
    : Number(chunkHeaders.get('content-length')) || 0;

  let resolvedEnd = currentEnd;
  if (total > 0 && (currentEnd === Infinity || currentEnd >= total)) {
    resolvedEnd = total - 1;
  }

  const status = req.headers.range && total > 0 ? 206 : 200;
  const headers = {
    'Content-Type':
      chunkHeaders.get('content-type') || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (total > 0) {
    headers['Content-Length'] = String(resolvedEnd - start + 1);
    if (req.headers.range) {
      headers['Content-Range'] = `bytes ${start}-${resolvedEnd}/${total}`;
    }
  }
  res.writeHead(status, headers);
  console.log(`[media] relaying ${total || '?'} bytes`);
  return { total, currentEnd: resolvedEnd };
}

async function relayChunks(rawUrl, start, end, req, res) {
  const upstreamHeaders = {
    'user-agent': UA,
    accept: '*/*',
    referer: 'https://www.youtube.com/',
    origin: 'https://www.youtube.com',
  };

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  let total = null;
  let pos = start;
  let currentEnd = end;

  while (total === null || pos <= currentEnd) {
    if (aborted) break;
    const sliceEnd =
      currentEnd === Infinity
        ? pos + MEDIA_CHUNK - 1
        : Math.min(pos + MEDIA_CHUNK - 1, currentEnd);

    const chunk = await fetchChunk(
      rawUrl,
      pos,
      sliceEnd,
      upstreamHeaders,
      aborted
    );
    if (writeChunkError(res, chunk)) return;

    const { chunkBuf, chunkHeaders } = chunk;

    if (total === null) {
      ({ total, currentEnd } = initRelayResponse(
        req,
        res,
        chunkHeaders,
        start,
        currentEnd
      ));
    }

    if (chunkBuf?.length && !aborted) {
      if (!res.write(chunkBuf)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    if (total <= 0) break;
    pos = sliceEnd + 1;
  }
}

function isPrivateTarget(rawUrl) {
  const target = new URL(rawUrl);
  if (!/^https?:$/u.test(target.protocol)) return true;
  const host = target.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') {
    return true;
  }
  return /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(host);
}

async function fetchChunk(rawUrl, pos, sliceEnd, headers, aborted) {
  for (let attempt = 0; attempt < MAX_MEDIA_RETRIES; attempt += 1) {
    if (aborted) return null;
    try {
      let current = rawUrl;
      let upstream = null;
      for (let hop = 0; hop < 4; hop += 1) {
        if (isPrivateTarget(current)) return { status: 403 };
        const res = await fetch(current, {
          headers: { ...headers, range: `bytes=${pos}-${sliceEnd}` },
          redirect: 'manual',
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return { status: 403 };
          current = new URL(loc, current).toString();
          continue;
        }
        upstream = res;
        break;
      }
      if (!upstream) return { status: 403 };
      if (upstream.status === 403) return { status: 403 };
      if (upstream.status !== 200 && upstream.status !== 206) {
        throw new Error(`upstream status ${upstream.status}`);
      }
      return {
        chunkHeaders: upstream.headers,
        chunkBuf: Buffer.from(await upstream.arrayBuffer()),
      };
    } catch {
      if (aborted) return null;
      console.warn(
        `[media] transient drop, retry ${attempt + 1}/${MAX_MEDIA_RETRIES}`
      );
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return null;
}

function handleYtdlp(req, res) {
  if (!SECRET || req.headers['x-ytdlp-secret'] !== SECRET) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 200000) req.destroy();
  });
  req.on('end', () => {
    let args = null;
    try {
      args = JSON.parse(body).args;
    } catch {
      sendJson(res, 400, { error: 'bad json' });
      return;
    }
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
      sendJson(res, 400, { error: 'bad args' });
      return;
    }
    if (args.some((a) => FORBIDDEN.has(a))) {
      sendJson(res, 403, { error: 'forbidden arg' });
      return;
    }
    const finalArgs = [];
    if (COOKIES && fs.existsSync(COOKIES)) finalArgs.push('--cookies', COOKIES);
    finalArgs.push(...args);
    const child = spawn(YTDLP, finalArgs);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) =>
      sendJson(res, 200, {
        stdout: '',
        stderr: String(err.message || err),
        code: 1,
      })
    );
    child.on('close', (code) => sendJson(res, 200, { stdout, stderr, code }));
    res.on('close', () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://127.0.0.1');
  const path = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && path === '/media') {
    handleMedia(parsed, req, res);
    return;
  }
  if (req.method === 'POST' && path === '/ytdlp') {
    handleYtdlp(req, res);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ytdlp-service] listening on 127.0.0.1:${PORT}`);
});
