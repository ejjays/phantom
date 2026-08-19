import { File, Paths } from 'expo-file-system';
import {
  FFmpegKit,
  FFmpegKitConfig,
  Level,
  ReturnCode,
} from '@nikhil-cephei/ffmpeg-kit-react-native';
import { downloadPlaylistToFile } from './hls';
import { DESKTOP_UA } from '../userAgents';
import { log, warn as logWarn } from '../log';
import {
  demuxToM4a as coreDemuxToM4a,
  hlsConcatToMp4 as coreHlsConcatToMp4,
  hlsMergeToMp4 as coreHlsMergeToMp4,
  muxVideoAudio as coreMuxVideoAudio,
  remuxToMp4 as coreRemuxToMp4,
  tagAudio as coreTagAudio,
} from '../media';

// ffmpeg-kit logs at verbose at default; only keep errors
void FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

// opt-in escape hatch; the pure-TS core is the primary path
const ENABLE_FFMPEG = process.env.EXPO_PUBLIC_FFMPEG_FALLBACK === '1';

// run the pure-TS core; ffmpeg only when explicitly enabled
async function coreOrFfmpeg<T extends unknown[]>(
  name: string,
  core: (...args: T) => Promise<boolean>,
  ffmpeg: (...args: T) => Promise<boolean>,
  ...args: T
): Promise<boolean> {
  let ok = false;
  try {
    ok = await core(...args);
  } catch (err) {
    logWarn('mux', `[${name}] core threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (ok) return true;
  if (ENABLE_FFMPEG) {
    logWarn('mux', `[${name}] core refused, ffmpeg fallback`);
    return ffmpeg(...args);
  }
  logWarn('mux', `[${name}] core refused, ffmpeg disabled`);
  return false;
}

function fsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

// large segments saturate at 8
const HLS_CONCURRENCY = 8;
// tiny segments need more parallelism
const MUXED_HLS_CONCURRENCY = 16;

/* video+audio -> one container, no re-encode */
export function muxVideoAudio(
  video: File,
  audio: File,
  out: File
): Promise<boolean> {
  return coreOrFfmpeg('mux', coreMuxVideoAudio, ffmpegMuxVideoAudio, video, audio, out);
}

async function ffmpegMuxVideoAudio(
  video: File,
  audio: File,
  out: File
): Promise<boolean> {
  const faststart = out.name.toLowerCase().endsWith('.mp4')
    ? ' -movflags +faststart'
    : '';
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(video.uri)}" -i "${fsPath(audio.uri)}" -c copy${faststart} "${fsPath(out.uri)}"`;

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

/* pull the audio track out of a muxed file, no re-encode (lossless, ~instant) */
export function demuxToM4a(src: File, out: File): Promise<boolean> {
  return coreOrFfmpeg('demux', coreDemuxToM4a, ffmpegDemuxToM4a, src, out);
}

async function ffmpegDemuxToM4a(src: File, out: File): Promise<boolean> {
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

/* still frame for media without page art; retries frame 0 on seek miss */
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

/* container swap only; fails when codecs aren't mp4-compatible (vp9/opus…) */
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

/* container compatibility, not extra quality */
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

// args form avoids shell-escaping metadata values
export function tagAudio(
  audio: File,
  out: File,
  meta: { title?: string; artist?: string; album?: string },
  cover?: File
): Promise<boolean> {
  return coreOrFfmpeg('tag', coreTagAudio, ffmpegTagAudio, audio, out, meta, cover);
}

async function ffmpegTagAudio(
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

/* hls playlist -> one mp4, no re-encode; optional separate audio playlist */
export function hlsToMp4(
  url: string,
  out: File,
  durationSec: number,
  onProgress: (pct: number) => void,
  audioUrl?: string,
  keepAlive?: boolean
): Promise<boolean> {
  // vimeo splits video & audio playlists; map both when present
  const inputs = audioUrl
    ? `-i "${url}" -i "${audioUrl}" -map 0:v:0 -map 1:a:0`
    : `-i "${url}"`;
  // reuse connection on same-host segments; off avoids cross-host redirect stalls
  const persistent = keepAlive ? '1' : '0';
  const cmd = `-hide_banner -loglevel error -y -http_persistent ${persistent} -user_agent "${HLS_UA}" ${inputs} -c copy -bsf:a aac_adtstoasc -movflags +faststart "${fsPath(out.uri)}"`;
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

/* parallel video+audio fetch, then -c copy mux */
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
    return await hlsMergeVideoAudio(video, audio, out);
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

// remux concatenated segments -> clean mp4, no re-encode
export function remuxToMp4(src: File, out: File): Promise<boolean> {
  return coreOrFfmpeg('remux', coreRemuxToMp4, ffmpegRemuxToMp4, src, out);
}

// hls concat (fmp4 or ts segments) -> clean mp4/m4a, core first
export function hlsConcatRemux(src: File, out: File): Promise<boolean> {
  return coreOrFfmpeg('hls-concat', coreHlsConcatToMp4, ffmpegRemuxToMp4, src, out);
}

// separate video+audio hls concats -> one mp4, core first
export function hlsMergeVideoAudio(
  video: File,
  audio: File,
  out: File
): Promise<boolean> {
  return coreOrFfmpeg('hls-merge', coreHlsMergeToMp4, ffmpegMuxVideoAudio, video, audio, out);
}

async function ffmpegRemuxToMp4(src: File, out: File): Promise<boolean> {
  const cmd = `-hide_banner -loglevel error -y -i "${fsPath(src.uri)}" -c copy -movflags +faststart "${fsPath(out.uri)}"`;
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

// muxed single playlist -> parallel segment fetch + one remux (skips serial ffmpeg)
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
    const ok = await hlsConcatRemux(seg, out);
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
