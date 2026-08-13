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

// ffmpeg-kit logs at verbose by default; only keep errors
void FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

function fsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

// large segments saturate at 8
const HLS_CONCURRENCY = 8;
// tiny segments need more parallelism
const MUXED_HLS_CONCURRENCY = 16;

/* video+audio -> one container, no re-encode */
export async function muxVideoAudio(
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

// remux concatenated segments -> clean mp4, no re-encode
async function remuxToMp4(src: File, out: File): Promise<boolean> {
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
