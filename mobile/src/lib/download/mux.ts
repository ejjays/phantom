import { File, FileMode, Paths } from 'expo-file-system';
import {
  FFmpegKit,
  FFmpegKitConfig,
  FFprobeKit,
  Level,
  ReturnCode,
} from '@nikhil-cephei/ffmpeg-kit-react-native';
import {
  downloadPlaylistToFile,
  nativeSegmentsToFiles,
  parseMediaPlaylist,
} from './hls';
import { DESKTOP_UA } from '../userAgents';
import { log, warn as logWarn } from '../log';
import { speechOfSilence } from '../subtitles';

// ffmpeg-kit verbose by default → keep errors only & silence upstream Loading log
const _origLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('ffmpeg-kit-react-native')) return;
  _origLog(...(args as []));
};
void FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

function fsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

// hls concurrency: fetch().arrayBuffer() parks each segment on the java
// heap (okhttp buffers whole responses), so keep in-flight low — 16-way
// bursts of 720p chunks oom 512mb heaps alongside webviews. 6 splits the
// difference: matches per-connection-throttled cdns without the heap risk.
const HLS_CONCURRENCY = 4;
const MUXED_HLS_CONCURRENCY = 6;
// native pulls bypass js heap + devtools inspection entirely, so this can
// run wider than the js fetch path without the same oom surface
const NATIVE_SEG_CONCURRENCY = 6;

export async function muxVideoAudio(
  video: File,
  audio: File,
  out: File
): Promise<boolean> {
  const faststart = out.name.toLowerCase().endsWith('.mp4')
    ? ' -movflags +faststart'
    : '';
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(video.uri)}" -i "${fsPath(audio.uri)}" -c copy -avoid_negative_ts make_zero${faststart} "${fsPath(out.uri)}"`;

  const session = await FFmpegKit.execute(cmd);
  const code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return true;

  const output = await session.getOutput();
  logWarn(
    'mux',
    `[mux] ffmpeg failed (${code}): ${String(output).slice(-600)}`
  );
  return false;
}

export async function demuxToM4a(src: File, out: File): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}" -vn -c:a copy -movflags +faststart "${fsPath(out.uri)}"`;
  const session = await FFmpegKit.execute(cmd);
  const code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return true;

  const output = await session.getOutput();
  logWarn(
    'mux',
    `[demux] ffmpeg failed (${code}): ${String(output).slice(-600)}`
  );
  return false;
}

// header-only read of the finished file: codec, edit lists and timestamp
// truth for system-thumbnail failures. no decode, reads header only.
export async function probeFile(src: File): Promise<void> {
  try {
    const session = await FFprobeKit.getMediaInformation(fsPath(src.uri));
    const info = session.getMediaInformation();
    if (!info) {
      log('mux', `[probe] ${src.name}: no info`);
      return;
    }
    const streams = (info.getStreams() ?? []).map(
      (stream) =>
        `${stream.getType()}:${stream.getCodec()} ${stream.getWidth()}x${stream.getHeight()} ${stream.getFormat()}`
    );
    log(
      'mux',
      `[probe] ${src.name}: fmt=${info.getFormat()} dur=${info.getDuration()} streams=[${streams.join(' | ')}]`
    );
  } catch {
    /* diagnostics optional */
  }
}

// embed the poster as the file's cover art so gallery/file-manager lists
// show artwork instead of a video frame (movies often fade in from black).
// never throws the download: caller keeps the original when this fails.
export async function attachCover(
  video: File,
  cover: File,
  out: File
): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(video.uri)}" -i "${fsPath(cover.uri)}" -map 0 -map 1 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic "${fsPath(out.uri)}"`;
  const session = await FFmpegKit.execute(cmd);
  if (ReturnCode.isSuccess(await session.getReturnCode())) return true;
  const output = await session.getOutput();
  logWarn(
    'mux',
    `[cover] ffmpeg failed (${await session.getReturnCode()}): ${String(output).slice(-400)}`
  );
  return false;
}

// single frame from a remote mp4 for seek previews. android's retriever
// chokes on some remote files (missing faststart, odd headers), while
// ffmpeg range-reads whatever it needs. never throws: true/false only.
export async function remoteExtractFrame(
  url: string,
  headers: Record<string, string>,
  timeSec: number,
  out: File
): Promise<boolean> {
  const block = Object.entries(headers)
    .filter(
      ([key]) =>
        key.toLowerCase() !== 'user-agent' &&
        key.toLowerCase() !== 'content-type'
    )
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('');
  const ua = headers['User-Agent'] ?? headers['user-agent'];
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(Math.max(0, Math.floor(timeSec))),
  ];
  if (block) args.push('-headers', block);
  if (ua) args.push('-user_agent', ua);
  args.push('-i', url, '-frames:v', '1', '-q:v', '5', fsPath(out.uri));
  try {
    const session = await FFmpegKit.executeWithArguments(args);
    return ReturnCode.isSuccess(await session.getReturnCode());
  } catch {
    return false;
  }
}

// voice activity for subtitle auto-sync: runs silencedetect over the first
// minutes of a stream and returns speaking intervals. never throws.
export async function detectSpeechSegments(
  url: string,
  headers: Record<string, string>,
  windowSec: number
): Promise<Array<{ start: number; end: number }> | null> {
  const block = Object.entries(headers)
    .filter(
      ([key]) =>
        key.toLowerCase() !== 'user-agent' &&
        key.toLowerCase() !== 'content-type'
    )
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('');
  const ua = headers['User-Agent'] ?? headers['user-agent'];
  const window = Math.min(600, Math.max(60, Math.floor(windowSec)));
  const run = async (extra: string[]): Promise<string | null> => {
    const args = ['-hide_banner', '-loglevel', 'info', '-y', ...extra];
    if (block) args.push('-headers', block);
    if (ua) args.push('-user_agent', ua);
    args.push(
      '-i',
      url,
      '-t',
      String(window),
      '-vn',
      '-af',
      'highpass=f=200,lowpass=f=3400,silencedetect=noise=-35dB:d=0.3',
      '-f',
      'null',
      '-'
    );
    try {
      const session = await FFmpegKit.executeWithArguments(args);
      if (!ReturnCode.isSuccess(await session.getReturnCode())) return null;
      return String(await session.getOutput());
    } catch {
      return null;
    }
  };
  // old on-device builds lack the extension allowlist: retry bare
  const output =
    (await run(['-allowed_segment_extensions', 'ALL'])) ?? (await run([]));
  if (output === null) return null;
  return speechOfSilence(output, window);
}

export async function extractFrame(src: File, out: File): Promise<boolean> {
  const base = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}"`;
  for (const seek of ['-ss 1', '']) {
    const session = await FFmpegKit.execute(
      `${base} ${seek} -frames:v 1 -q:v 3 "${fsPath(out.uri)}"`
    );
    if (ReturnCode.isSuccess(await session.getReturnCode())) return true;
  }
  return false;
}

// short audio sample for cloud transcription: window minutes as small mono
// mp3 from an offset, returns the fs path or null. old on-device builds
// lack the extension allowlist flag, so retry bare when flagged runs fail.
// never throws.
export async function extractAudioSample(
  url: string,
  headers: Record<string, string>,
  out: File,
  windowSec: number,
  offsetSec = 0
): Promise<string | null> {
  const block = Object.entries(headers)
    .filter(
      ([key]) =>
        key.toLowerCase() !== 'user-agent' &&
        key.toLowerCase() !== 'content-type'
    )
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('');
  const ua = headers['User-Agent'] ?? headers['user-agent'];
  const window = String(Math.max(60, Math.min(300, Math.floor(windowSec))));
  const run = async (extra: string[], quiet: boolean): Promise<boolean> => {
    const args = [
      '-hide_banner',
      '-loglevel',
      quiet ? 'quiet' : 'error',
      '-y',
      ...extra,
    ];
    if (block) args.push('-headers', block);
    if (ua) args.push('-user_agent', ua);
    if (offsetSec > 0) args.push('-ss', String(Math.floor(offsetSec)));
    args.push(
      '-i',
      url,
      '-t',
      window,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      fsPath(out.uri)
    );
    try {
      const session = await FFmpegKit.executeWithArguments(args);
      return ReturnCode.isSuccess(await session.getReturnCode());
    } catch {
      return false;
    }
  };
  const ok =
    (await run(['-allowed_segment_extensions', 'ALL'], true)) ||
    (await run([], false));
  return ok ? fsPath(out.uri) : null;
}

export async function encodeToMp4(src: File, out: File): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${fsPath(out.uri)}"`;
  const session = await FFmpegKit.execute(cmd);
  if (ReturnCode.isSuccess(await session.getReturnCode())) return true;

  const output = await session.getOutput();
  logWarn(
    'mux',
    `[encode-mp4] ffmpeg failed (${await session.getReturnCode()}): ${String(output).slice(-400)}`
  );
  return false;
}

export async function transcodeToMp3(src: File, out: File): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}" -vn -c:a libmp3lame -q:a 2 "${fsPath(out.uri)}"`;
  const session = await FFmpegKit.execute(cmd);
  const code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return true;

  const output = await session.getOutput();
  logWarn(
    'mux',
    `[mp3] ffmpeg failed (${code}): ${String(output).slice(-600)}`
  );
  return false;
}

// args form avoids shell-escaping metadata
export async function tagAudio(
  audio: File,
  out: File,
  meta: { title?: string; artist?: string; album?: string },
  cover?: File
): Promise<boolean> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    fsPath(audio.uri),
  ];
  if (cover) args.push('-i', fsPath(cover.uri));
  args.push('-map', '0:a');
  if (cover) args.push('-map', '1:v', '-disposition:v:0', 'attached_pic');
  args.push('-c', 'copy');
  if (out.name.toLowerCase().endsWith('.mp3')) {
    args.push('-id3v2_version', '3');
  }
  if (meta.title) args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  if (meta.album) args.push('-metadata', `album=${meta.album}`);
  args.push(fsPath(out.uri));

  const session = await FFmpegKit.executeWithArguments(args);
  const code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return true;
  const output = await session.getOutput();
  logWarn(
    'mux',
    `[tag] ffmpeg failed (${code}): ${String(output).slice(-400)}`
  );
  return false;
}

const HLS_UA = DESKTOP_UA;

export function hlsToMp4(
  url: string,
  out: File,
  durationSec: number,
  onProgress: (pct: number) => void,
  audioUrl?: string,
  keepAlive?: boolean
): Promise<boolean> {
  // vimeo splits video/audio; persistent 0 avoids cross-host stall
  const inputs = audioUrl
    ? `-i "${url}" -i "${audioUrl}" -map 0:v:0 -map 1:a:0`
    : `-i "${url}"`;
  const persistent = keepAlive ? '1' : '0';
  const cmd = `-hide_banner -loglevel error -y -http_persistent ${persistent} -user_agent "${HLS_UA}" ${inputs} -c copy -bsf:a aac_adtstoasc -avoid_negative_ts make_zero -movflags +faststart "${fsPath(out.uri)}"`;
  return new Promise((resolve) => {
    void FFmpegKit.executeAsync(
      cmd,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- ffmpeg-kit ignores callback promise
      async (session) => {
        const code = await session.getReturnCode();
        if (ReturnCode.isSuccess(code)) {
          resolve(true);
          return;
        }
        const output = await session.getOutput();
        logWarn(
          'mux',
          `[hls] ffmpeg failed (${code}): ${String(output).slice(-600)}`
        );
        resolve(false);
      },
      undefined,
      (stats: { getTime: () => number }) => {
        if (durationSec <= 0) return;
        const pct = Math.round((stats.getTime() / 1000 / durationSec) * 100);
        if (pct > 0) onProgress(Math.min(99, pct));
      }
    );
  });
}

// ffmpeg pulls the playlist itself over its own http stack: no js heap,
// no per-segment bridge traffic, invisible to devtools inspection.
// -headers rides on every segment request, same as the extractor headers.
export function hlsDirectToMp4(
  url: string,
  out: File,
  durationSec: number,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  keepAlive?: boolean
): Promise<boolean> {
  const block = Object.entries(headers)
    .filter(
      ([key]) =>
        key.toLowerCase() !== 'user-agent' &&
        key.toLowerCase() !== 'content-type'
    )
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('');
  const ua = headers['User-Agent'] ?? headers['user-agent'];
  const persistent = keepAlive ? '1' : '0';
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-http_persistent',
    persistent,
  ];
  if (block) args.push('-headers', block);
  if (ua) args.push('-user_agent', ua);
  args.push(
    // wedged segments stall the whole pull: drop + reconnect instead
    '-rw_timeout',
    '20000000',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '3',
    '-i',
    url,
    '-c',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    fsPath(out.uri)
  );
  const started = Date.now();
  let lastTick = Date.now();
  let nextDecile = 10;
  let stallNoted = false;
  return new Promise((resolve) => {
    const watcher = setInterval(() => {
      const quietMs = Date.now() - lastTick;
      if (quietMs > 15000 && !stallNoted) {
        stallNoted = true;
        log('mux', '[hls-direct] no progress for 15s (slow segment, not dead)');
      }
    }, 5000);
    const finish = (ok: boolean): void => {
      clearInterval(watcher);
      resolve(ok);
    };
    void FFmpegKit.executeWithArgumentsAsync(
      args,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- ffmpeg-kit ignores callback promise
      async (session) => {
        const code = await session.getReturnCode();
        if (ReturnCode.isSuccess(code)) {
          const secs = (Date.now() - started) / 1000;
          const mb = (out.size ?? 0) / 1e6;
          const mbps = secs > 0 ? ((mb * 8) / secs).toFixed(1) : '0';
          log(
            'mux',
            `[hls-direct] ${mb.toFixed(1)}MB in ${secs.toFixed(1)}s = ${mbps} Mbps`
          );
          finish(true);
          return;
        }
        const output = await session.getOutput();
        logWarn(
          'mux',
          `[hls-direct] ffmpeg failed (${code}): ${String(output).slice(-600)}`
        );
        finish(false);
      },
      undefined,
      (stats: { getTime: () => number }) => {
        if (durationSec <= 0) return;
        const pct = Math.round((stats.getTime() / 1000 / durationSec) * 100);
        if (pct > 0) onProgress(Math.min(99, pct));
        lastTick = Date.now();
        stallNoted = false;
        if (pct >= nextDecile) {
          const secs = (Date.now() - started) / 1000;
          log(
            'mux',
            `[hls-direct] ${Math.min(99, pct)}% (${secs.toFixed(0)}s elapsed)`
          );
          nextDecile += 10;
        }
      }
    );
  });
}

export async function parallelHlsToMp4(
  videoPlaylist: string,
  audioPlaylist: string,
  out: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const video = new File(Paths.cache, `${out.name}.v.mp4`);
  const audio = new File(Paths.cache, `${out.name}.a.mp4`);
  try {
    const started = Date.now();
    const vid = await downloadPlaylistToFile(
      videoPlaylist,
      headers,
      video,
      (done, total) => onProgress(Math.round((done / total) * 80)),
      HLS_CONCURRENCY,
      signal
    );
    const aud = await downloadPlaylistToFile(
      audioPlaylist,
      headers,
      audio,
      (done, total) => onProgress(80 + Math.round((done / total) * 12)),
      HLS_CONCURRENCY,
      signal
    );
    const secs = (Date.now() - started) / 1000;
    const totalBytes = vid.bytes + aud.bytes;
    const mbps = secs > 0 ? ((totalBytes * 8) / 1e6 / secs).toFixed(1) : '0';
    log(
      'mux',
      `[hls-parallel] ${vid.segments}+${aud.segments} chunks, ${(totalBytes / 1e6).toFixed(1)}MB in ${secs.toFixed(1)}s = ${mbps} Mbps`
    );
    return await muxVideoAudio(video, audio, out);
  } catch (err: unknown) {
    logWarn(
      'mux',
      `[hls-parallel] ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  } finally {
    if (video.exists) video.delete();
    if (audio.exists) audio.delete();
  }
}

export async function remuxToMp4(src: File, out: File): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}" -c copy -avoid_negative_ts make_zero -movflags +faststart "${fsPath(out.uri)}"`;
  const session = await FFmpegKit.execute(cmd);
  const code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return true;
  const output = await session.getOutput();
  logWarn(
    'mux',
    `[remux] ffmpeg failed (${code}): ${String(output).slice(-400)}`
  );
  return false;
}

// native-stack variant of the parallel pull: segments land on disk via
// blob-util (no js heap, invisible to devtools inspection), then ffmpeg
// concat joins them — same output as parallelHlsMuxedToMp4 without the oom
export async function nativeHlsMuxedToMp4(
  playlist: string,
  out: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const tag = out.name.replace(/[^a-z0-9]+/giu, '_');
  const made: string[] = [];
  const sweep = (): void => {
    for (const path of made) {
      try {
        new File(path).delete();
      } catch {
        /* best effort */
      }
    }
    made.length = 0;
  };
  try {
    const res = await fetch(playlist, { headers, signal });
    if (!res.ok) return false;
    const urls = parseMediaPlaylist(await res.text(), playlist);
    if (urls.length === 0) return false;
    const dests = urls.map(
      (_, idx) =>
        `${Paths.cache.uri}/${tag}-seg-${String(idx).padStart(6, '0')}.ts`
    );
    await nativeSegmentsToFiles(
      urls,
      headers,
      dests,
      (done, total) => onProgress(Math.round((done / total) * 80)),
      NATIVE_SEG_CONCURRENCY,
      signal
    );
    made.push(...dests);
    const list = new File(Paths.cache, `${tag}-list.txt`);
    const lines = dests
      .map((dest) => `file '${fsPath(dest).replace(/'/gu, "'\\''")}'`)
      .join('\n');
    const handle = list.open(FileMode.WriteOnly);
    try {
      handle.writeBytes(new TextEncoder().encode(lines));
    } finally {
      handle.close();
    }
    made.push(list.uri);
    const joined = new File(Paths.cache, `${tag}-joined.ts`);
    made.push(joined.uri);
    const concat = await FFmpegKit.execute(
      `-hide_banner -loglevel error -y -f concat -safe 0 -i "${fsPath(list.uri)}" -c copy "${fsPath(joined.uri)}"`
    );
    if (!ReturnCode.isSuccess(await concat.getReturnCode())) return false;
    onProgress(88);
    const ok = await remuxToMp4(joined, out);
    if (ok) onProgress(92);
    return ok;
  } catch (err: unknown) {
    logWarn(
      'mux',
      `[hls-native] ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  } finally {
    sweep();
  }
}

export async function parallelHlsMuxedToMp4(
  playlist: string,
  out: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const seg = new File(Paths.cache, `${out.name}.seg`);
  try {
    const started = Date.now();
    const { segments, bytes } = await downloadPlaylistToFile(
      playlist,
      headers,
      seg,
      (done, total) => onProgress(Math.round((done / total) * 92)),
      MUXED_HLS_CONCURRENCY,
      signal
    );
    const ok = await remuxToMp4(seg, out);
    const secs = (Date.now() - started) / 1000;
    const mbps = secs > 0 ? ((bytes * 8) / 1e6 / secs).toFixed(1) : '0';
    log(
      'mux',
      `[hls-parallel] ${segments} chunks, ${(bytes / 1e6).toFixed(1)}MB in ${secs.toFixed(1)}s = ${mbps} Mbps`
    );
    return ok;
  } catch (err: unknown) {
    logWarn(
      'mux',
      `[hls-parallel-muxed] ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  } finally {
    if (seg.exists) seg.delete();
  }
}
