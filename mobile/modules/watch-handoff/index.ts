import { requireNativeModule } from 'expo-modules-core';

type WatchJobEvent = { job: string };

type WatchDownloadDone = {
  id: string;
  title: string;
  season: number;
  episode: number;
  poster: string;
  uri: string;
};

type WatchHandoffNative = {
  takePendingJob(): Promise<string | null>;
  consumeJob(job: string): Promise<void>;
  notifyDownloadDone(p: WatchDownloadDone): Promise<void>;
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

export function notifyWatchDownloadDone(
  payload: WatchDownloadDone
): Promise<void> {
  return (native?.notifyDownloadDone(payload) ?? Promise.resolve()).catch(
    () => undefined
  );
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
