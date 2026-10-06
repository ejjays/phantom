import { File, Paths } from 'expo-file-system';
import {
  FFmpegKit,
  FFmpegKitConfig,
  FFprobeKit,
  Level,
  ReturnCode,
} from '@nikhil-cephei/ffmpeg-kit-react-native';
import { downloadPlaylistToFile } from './hls';
import { DESKTOP_UA } from '../userAgents';
import { log, warn as logWarn } from '../log';

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
    // video+audio pull at once — two region sets multiply throughput the
    // same way parallel segments do; progress reporters interleave, last
    // writer wins, both stay monotonic within their own 0-80 / 80-92 lane
    const [vid, aud] = await Promise.all([
      downloadPlaylistToFile(
        videoPlaylist,
        headers,
        video,
        (done, total) => onProgress(Math.round((done / total) * 80)),
        HLS_CONCURRENCY,
        signal
      ),
      downloadPlaylistToFile(
        audioPlaylist,
        headers,
        audio,
        (done, total) => onProgress(80 + Math.round((done / total) * 12)),
        HLS_CONCURRENCY,
        signal
      ),
    ]);
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
