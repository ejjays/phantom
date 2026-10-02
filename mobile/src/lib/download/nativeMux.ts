import { File } from 'expo-file-system';
import { muxAv, remuxParts, concatFiles } from '../../../modules/media-mux';
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
  return stats.bytes > 0 && out.exists && out.size > 0;
}

export async function nativeMuxVideoAudio(
  videoFile: File,
  audioFile: File,
  outFile: File
): Promise<boolean> {
  if (forcedOff('av')) return false;
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
