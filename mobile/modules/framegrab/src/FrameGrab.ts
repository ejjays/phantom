import { requireNativeModule } from 'expo-modules-core';

export type FrameGrabModuleType = {
  extract(src: string, out: string, seekMs: number): Promise<boolean>;
};

const native = requireNativeModule<FrameGrabModuleType>('FrameGrab');

export const extractFrame = (
  src: string,
  out: string,
  seekMs: number
): Promise<boolean> => native.extract(src, out, seekMs);
