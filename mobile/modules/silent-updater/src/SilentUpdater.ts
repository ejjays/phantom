import { requireNativeModule } from 'expo-modules-core';

export type InstallOutcome = 'started';

export type SilentUpdaterModuleType = {
  hasInstallPermission(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<void>;
  installApk(path: string): Promise<InstallOutcome>;
  installViaSystem(path: string): Promise<InstallOutcome>;
  saveToDownloads(sourcePath: string, name: string): Promise<string>;
};

const native = requireNativeModule<SilentUpdaterModuleType>('SilentUpdater');

export const hasInstallPermission = (): Promise<boolean> =>
  native.hasInstallPermission();

export const openInstallPermissionSettings = (): Promise<void> =>
  native.openInstallPermissionSettings();

export const installApk = (path: string): Promise<InstallOutcome> =>
  native.installApk(path);

export const installViaSystem = (path: string): Promise<InstallOutcome> =>
  native.installViaSystem(path);

export const saveToDownloads = (
  sourcePath: string,
  name: string
): Promise<string> => native.saveToDownloads(sourcePath, name);