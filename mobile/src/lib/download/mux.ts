import { File, Paths } from 'expo-file-system';
import { downloadPlaylistToFile } from './hls';
import { log, warn as logWarn } from '../log';
import {
  demuxToM4a as coreDemuxToM4a,
  hlsConcatToMp4 as coreHlsConcatToMp4,
  hlsMergeToMp4 as coreHlsMergeToMp4,
  muxVideoAudio as coreMuxVideoAudio,
  remuxToMp4 as coreRemuxToMp4,
  tagAudio as coreTagAudio,
} from '../media';
import { extractFrame as framegrabExtract } from '../../../modules/framegrab';
import { encodeToMp4 as nativeEncodeToMp4 } from '../../../modules/encodeh264aac';

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
  return coreMuxVideoAudio(video, audio, out);
}

/* pull the audio track out of a muxed file, no re-encode (lossless, ~instant) */
export function demuxToM4a(src: File, out: File): Promise<boolean> {
  return coreDemuxToM4a(src, out);
}

/* still frame for media without page art; retries frame 0 on seek miss */
export async function extractFrame(src: File, out: File): Promise<boolean> {
  const started = Date.now();
  for (const seekMs of [1000, 0]) {
    try {
      if (await framegrabExtract(fsPath(src.uri), fsPath(out.uri), seekMs)) {
        log('mux', `[frame] ok in ${Date.now() - started}ms`);
        return true;
      }
    } catch (err: unknown) {
      logWarn(
        'mux',
        `[frame] seek ${seekMs}ms failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return false;
}

/* container swap only; fails when codecs aren't mp4-compatible (vp9/opus…) */
export async function encodeToMp4(src: File, out: File): Promise<boolean> {
  const started = Date.now();
  try {
    const ok = await nativeEncodeToMp4(fsPath(src.uri), fsPath(out.uri));
    log(
      'mux',
      `[encode-mp4] ${ok ? 'ok' : 'failed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
    return ok;
  } catch (err: unknown) {
    logWarn(
      'mux',
      `[encode-mp4] ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

// args form avoids shell-escaping metadata values
export function tagAudio(
  audio: File,
  out: File,
  meta: { title?: string; artist?: string; album?: string },
  cover?: File
): Promise<boolean> {
  return coreTagAudio(audio, out, meta, cover);
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
  return coreRemuxToMp4(src, out);
}

// hls concat (fmp4 or ts segments) -> clean mp4/m4a
export function hlsConcatRemux(src: File, out: File): Promise<boolean> {
  return coreHlsConcatToMp4(src, out);
}

// separate video+audio hls concats -> one mp4
export function hlsMergeVideoAudio(
  video: File,
  audio: File,
  out: File
): Promise<boolean> {
  return coreHlsMergeToMp4(video, audio, out);
}

// muxed single playlist -> parallel segment fetch + one remux
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
