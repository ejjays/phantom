import { requireNativeModule } from 'expo-modules-core';

export type MuxStats = {
  bytes: number;
  videoSamples: number;
  audioSamples: number;
};

type MediaMuxModuleType = {
  muxAv(videoPath: string, audioPath: string, outPath: string): Promise<MuxStats>;
  remuxParts(inputs: string[], outPath: string): Promise<MuxStats>;
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
