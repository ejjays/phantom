import { requireNativeModule } from 'expo-modules-core';

export type DownloadEvent = {
  jobId: string;
  bytes: number;
  total: number;
};

export type DownloadDoneEvent = {
  jobId: string;
  state: 'done' | 'failed' | 'cancelled';
  bytes: number;
  total: number;
  error?: string;
  httpCode?: number;
};

export type DownloadJob = {
  id: string;
  cancel(): void;
};

type MediaDownloaderModuleType = {
  startDownload(
    jobId: string,
    url: string,
    destPath: string,
    headers: Record<string, string>,
    resumeBytes: number,
    parallel: number
  ): Promise<void>;
  cancelDownload(jobId: string): Promise<void>;
  cancelAll(): Promise<void>;
};

const native = requireNativeModule<MediaDownloaderModuleType>('MediaDownloader');

type ModuleEmitter = {
  addListener(
    name: 'onDownloadProgress',
    listener: (e: DownloadEvent) => void
  ): { remove(): void };
  addListener(
    name: 'onDownloadDone',
    listener: (e: DownloadDoneEvent) => void
  ): { remove(): void };
};

// SDK 52+: the native module instance itself is an EventEmitter
const emitter = native as unknown as ModuleEmitter;

export function startDownload(
  jobId: string,
  url: string,
  destPath: string,
  headers: Record<string, string>,
  resumeBytes: number,
  onProgress: (e: DownloadEvent) => void,
  onDone: (e: DownloadDoneEvent) => void,
  parallel = 1
): DownloadJob {
  // listeners first: a finished-first race would lose the done event
  const sub1 = emitter.addListener('onDownloadProgress', onProgress);
  const sub2 = emitter.addListener('onDownloadDone', onDone);
  void native.startDownload(jobId, url, destPath, headers, resumeBytes, parallel);
  const release = (): void => {
    sub1.remove();
    sub2.remove();
  };
  return {
    id: jobId,
    cancel: () => {
      release();
      void native.cancelDownload(jobId);
    },
  };
}

export function cancelAll(): Promise<void> {
  return native.cancelAll();
}