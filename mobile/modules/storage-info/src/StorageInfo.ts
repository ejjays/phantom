import { requireNativeModule } from 'expo-modules-core';

export type VolumeInfo = {
  path: string;
  free: number;
  total: number;
};

type StorageInfoModuleType = {
  internalFreeBytes(): Promise<number>;
  internalTotalBytes(): Promise<number>;
  allVolumes(): Promise<VolumeInfo[]>;
};

const native = requireNativeModule<StorageInfoModuleType>('StorageInfo');

export const internalFreeBytes = (): Promise<number> =>
  native.internalFreeBytes();

export const internalTotalBytes = (): Promise<number> =>
  native.internalTotalBytes();

export const allVolumes = (): Promise<VolumeInfo[]> => native.allVolumes();