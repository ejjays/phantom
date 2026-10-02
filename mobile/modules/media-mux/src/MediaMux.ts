import { requireNativeModule } from 'expo-modules-core';

export type MuxStats = {
  bytes: number;
  videoSamples: number;
  audioSamples: number;
};

type MediaMuxModuleType = {
  muxAv(videoPath: string, audioPath: string, outPath: string): Promise<MuxStats>;
  remuxParts(inputs: string[], outPath: string): Promise<MuxStats>;
  concatFiles(inputs: string[], outPath: string): Promise<{ bytes: number }>;
  remuxWebm(
    videoPath: string | null,
    audioPath: string | null,
    outPath: string
  ): Promise<{ bytes: number }>;
  cloneFragmentedMp4(inPath: string, outPath: string): Promise<{ bytes: number }>;
};

const native = requireNativeModule<MediaMuxModuleType>('MediaMux');

export function muxAv(
  videoPath: string,
  audioPath: string,
  outPath: string
): Promise<MuxStats> {
  return native.muxAv(videoPath, audioPath, outPath);
}

export function remuxParts(inputs: string[], outPath: string): Promise<MuxStats> {
  return native.remuxParts(inputs, outPath);
}

export function concatFiles(inputs: string[], outPath: string): Promise<{ bytes: number }> {
  return native.concatFiles(inputs, outPath);
}

export function remuxWebm(
  videoPath: string | null,
  audioPath: string | null,
  outPath: string
): Promise<{ bytes: number }> {
  return native.remuxWebm(videoPath, audioPath, outPath);
}

export function cloneFragmentedMp4(inPath: string, outPath: string): Promise<{ bytes: number }> {
  return native.cloneFragmentedMp4(inPath, outPath);
}
