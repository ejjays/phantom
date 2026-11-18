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
  peekPendingJob(): Promise<string | null>;
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
  // old binary without handoff receiver, js still boots
}

export function takePendingJob(): Promise<string | null> {
  return native?.takePendingJob() ?? Promise.resolve(null);
}

// job stays in durable queue until picker shown, so reload/lost event cant drop handoff between "phantom opened" and "picker visible"
export function peekPendingJob(): Promise<string | null> {
  try {
    const peek = native?.peekPendingJob;
    if (peek) return peek();
  } catch {
    // old binary without peek, fallback to destructive read
  }
  return takePendingJob();
}

export function consumeWatchJob(job: string): Promise<void> {
  return (native?.consumeJob(job) ?? Promise.resolve()).catch(() => undefined);
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
  // do not consume: event can fire before react mounted or context about to be torn down; keeping it in queue lets poll recover it; removed once picker dismissed
  return (
    native?.addListener('onDownloadJob', (event) => {
      listener(event.job);
    }) ?? { remove: () => undefined }
  );
}
