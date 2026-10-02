import { File, Paths } from 'expo-file-system';
import {
  muxAv,
  remuxParts,
  remuxWebm,
  concatFiles,
  demuxAudio,
  extractFrame,
  tagAudioFile,
} from '../../../modules/media-mux';
import { downloadPlaylistToFiles } from './hls';
import { log, warn as logWarn } from '../log';

// dev-only A/B switch: true skips every native attempt so timings can be
// compared against the ffmpeg path on the same file. flip + metro reload,
// no rebuild needed. never ship true.
export const FORCE_FFMPEG_MUX = false;

function forcedOff(where: string): boolean {
  if (FORCE_FFMPEG_MUX) {
    log('nativeMux', `[native-mux] ${where} skipped (forced ffmpeg)`);
    return true;
  }
  return false;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rawPath(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//u, ''));
}

function validOutput(out: File, stats: { bytes: number }): boolean {
  const ok = stats.bytes > 0 && out.exists && out.size > 0;
  if (!ok) {
    logWarn(
      'nativeMux',
      `[native-mux] empty output for ${out.name} (claimed ${stats.bytes} bytes)`
    );
  }
  return ok;
}

export async function nativeMuxVideoAudio(
  videoFile: File,
  audioFile: File,
  outFile: File
): Promise<boolean> {
  if (forcedOff('av')) return false;
  const videoPath = rawPath(videoFile);
  const audioPath = rawPath(audioFile);
  if (videoPath.toLowerCase().endsWith('.webm') || audioPath.toLowerCase().endsWith('.webm')) {
    return nativeRemuxWebm(videoFile, audioFile, outFile);
  }
  try {
    if (outFile.exists) outFile.delete();
    const started = Date.now();
    const stats = await muxAv(
      rawPath(videoFile),
      rawPath(audioFile),
      rawPath(outFile)
    );
    log(
      'nativeMux',
      `[native-mux] av ok: ${stats.videoSamples}+${stats.audioSamples} samples in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
    return validOutput(outFile, stats);
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] av failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeRemux(srcFile: File, outFile: File): Promise<boolean> {
  if (forcedOff('remux')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const stats = await remuxParts([rawPath(srcFile)], rawPath(outFile));
    return validOutput(outFile, stats);
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] remux failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeRemuxWebm(
  videoFile: File,
  audioFile: File,
  outFile: File
): Promise<boolean> {
  if (forcedOff('webm')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const started = Date.now();
    const { bytes } = await remuxWebm(rawPath(videoFile), rawPath(audioFile), rawPath(outFile));
    log(
      'nativeMux',
      `[native-mux] webm ok: ${bytes} bytes in ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
    return validOutput(outFile, { bytes });
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] webm failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeDemuxAudio(srcFile: File, outFile: File): Promise<boolean> {
  if (forcedOff('demux')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const stats = await demuxAudio(rawPath(srcFile), rawPath(outFile));
    log('nativeMux', `[native-mux] demux ok: ${stats.audioSamples} samples`);
    return validOutput(outFile, stats);
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] demux failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeExtractFrame(
  srcFile: File,
  outFile: File,
  positionUs: number
): Promise<boolean> {
  if (forcedOff('frame')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const { bytes } = await extractFrame(rawPath(srcFile), rawPath(outFile), positionUs);
    const ok = bytes > 0 && validOutput(outFile, { bytes });
    if (ok) log('nativeMux', `[native-mux] frame ok: ${bytes} bytes @${positionUs}us`);
    return ok;
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] frame failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeTagAudio(
  audioFile: File,
  outFile: File,
  meta: { title?: string; artist?: string; album?: string },
  cover?: File
): Promise<boolean> {
  if (forcedOff('tag')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const { bytes } = await tagAudioFile(
      rawPath(audioFile),
      rawPath(outFile),
      meta.title ?? null,
      meta.artist ?? null,
      meta.album ?? null,
      cover ? rawPath(cover) : null
    );
    log('nativeMux', `[native-mux] tag ok: ${bytes} bytes`);
    return validOutput(outFile, { bytes });
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] tag failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeRemuxParts(files: File[], outFile: File): Promise<boolean> {
  if (forcedOff('parts')) return false;
  try {
    if (outFile.exists) outFile.delete();
    const started = Date.now();
    const stats = await remuxParts(files.map(rawPath), rawPath(outFile));
    log(
      'nativeMux',
      `[native-mux] parts ok: ${files.length} files, ${stats.videoSamples}+${stats.audioSamples} samples in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
    return validOutput(outFile, stats);
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] parts failed (${reason(error)}), ffmpeg next`);
    return false;
  }
}

export async function nativeConcat(files: File[], outFile: File): Promise<boolean> {
  try {
    if (outFile.exists) outFile.delete();
    const { bytes } = await concatFiles(files.map(rawPath), rawPath(outFile));
    return bytes > 0 && validOutput(outFile, { bytes });
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] concat failed (${reason(error)})`);
    return false;
  }
}

export async function nativeHlsAssemble(
  url: string,
  audioUrl: string | undefined,
  out: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  if (forcedOff('hls')) return false;
  const tag = `${out.name}.hls`;
  const parts: File[] = [];
  try {
    const makeFiles = async (
      playlist: string,
      prefix: string,
      base: number,
      cap: number
    ): Promise<File[]> => {
      const { files } = await downloadPlaylistToFiles(
        playlist,
        headers,
        (idx) => {
          const file = new File(Paths.cache, `${tag}-${prefix}-${idx}`);
          parts.push(file);
          return file;
        },
        (done, total) => onProgress(base + Math.round((done / total) * cap)),
        8,
        signal
      );
      return files;
    };
    if (audioUrl) {
      const [video, audio] = await Promise.all([
        (async () => {
          const files = await makeFiles(url, 'v', 0, 40);
          const joined = new File(Paths.cache, `${tag}-v.mp4`);
          parts.push(joined);
          return (await nativeConcat(files, joined)) ? joined : null;
        })(),
        (async () => {
          const files = await makeFiles(audioUrl, 'a', 40, 40);
          const joined = new File(Paths.cache, `${tag}-a.mp4`);
          parts.push(joined);
          return (await nativeConcat(files, joined)) ? joined : null;
        })(),
      ]);
      if (!video || !audio) return false;
      return nativeMuxVideoAudio(video, audio, out);
    }
    const files = await makeFiles(url, 'm', 0, 92);
    return nativeRemuxParts(files, out);
  } catch (error: unknown) {
    logWarn('nativeMux', `[native-mux] hls assemble failed (${reason(error)}), ffmpeg next`);
    return false;
  } finally {
    for (const file of parts) {
      if (file.exists) file.delete();
    }
  }
}
