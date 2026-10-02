import { File } from 'expo-file-system';
import { muxAv, remuxParts } from '../../../modules/media-mux';
import { log } from '../log';

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
      `[native-mux] av ${stats.videoSamples}+${stats.audioSamples} samples in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
    return validOutput(outFile, stats);
  } catch {
    return false;
  }
}

export async function nativeRemux(srcFile: File, outFile: File): Promise<boolean> {
  try {
    if (outFile.exists) outFile.delete();
    const stats = await remuxParts([rawPath(srcFile)], rawPath(outFile));
    return validOutput(outFile, stats);
  } catch {
    return false;
  }
}
