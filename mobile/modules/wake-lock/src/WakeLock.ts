import { requireNativeModule } from 'expo-modules-core';

export type LockState = { cpu: boolean; wifi: boolean };

export type WakeLockModuleType = {
  acquireCpuLock(tag: string): Promise<void>;
  releaseCpuLock(): Promise<void>;
  acquireWifiLock(tag: string): Promise<void>;
  releaseWifiLock(): Promise<void>;
  lockState(): Promise<LockState>;
};

const native = requireNativeModule<WakeLockModuleType>('WakeLock');

export const acquireCpuLock = (tag: string): Promise<void> =>
  native.acquireCpuLock(tag);

export const releaseCpuLock = (): Promise<void> => native.releaseCpuLock();

export const acquireWifiLock = (tag: string): Promise<void> =>
  native.acquireWifiLock(tag);

export const releaseWifiLock = (): Promise<void> => native.releaseWifiLock();

export const lockState = (): Promise<LockState> => native.lockState();