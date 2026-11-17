import { requireNativeModule } from 'expo-modules-core';

type WatchJobEvent = { job: string };

type WatchHandoffNative = {
  takePendingJob(): Promise<string | null>;
  consumeJob(job: string): Promise<void>;
  saveTextToMovies(
    fileName: string,
    mime: string,
    text: string,
    folder: string
  ): Promise<boolean>;
  addListener(
    name: 'onDownloadJob',
    listener: (event: WatchJobEvent) => void
  ): { remove(): void };
};

let native: WatchHandoffNative | null = null;
try {
  native = requireNativeModule<WatchHandoffNative>('WatchHandoff');
} catch {
  // old native binary without the handoff receiver; JS still boots
}

export function takePendingJob(): Promise<string | null> {
  return native?.takePendingJob() ?? Promise.resolve(null);
}

export function saveTextToMovies(
  fileName: string,
  mime: string,
  text: string,
  folder: string
): Promise<boolean> {
  return (
    native?.saveTextToMovies(fileName, mime, text, folder) ??
    Promise.resolve(false)
  );
}

export function addWatchJobListener(listener: (raw: string) => void): {
  remove(): void;
} {
  return (
    native?.addListener('onDownloadJob', (event) => {
      void native?.consumeJob(event.job);
      listener(event.job);
    }) ?? { remove: () => undefined }
  );
}
