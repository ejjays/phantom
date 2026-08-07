import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { Format, VideoInfo } from '../extractors/types';

const INFLIGHT_KEY = 'phantom.download.inflight';

export type DownloadInfoSubset = Pick<
  VideoInfo,
  'title' | 'uploader' | 'album' | 'thumbnail' | 'duration' | 'extractorKey' | 'downloadHeaders'
>;

export type InflightItem = {
  id: string;
  title: string;
  author?: string;
  platform: string;
  ext: string;
  isAudio: boolean;
  thumbnail?: string;
  progress: number;
  updatedAt: number;
  info: DownloadInfoSubset;
  format: Format;
  tag?: { title?: string; artist?: string };
};

let memory: InflightItem[] = [];
AsyncStorage.getItem(INFLIGHT_KEY)
  .then((raw) => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as InflightItem[];
        if (Array.isArray(parsed)) memory = parsed;
      } catch {
        /* ignore */
      }
    }
  })
  .catch(() => {
    /* ignore */
  });

/**
 * Loads the persisted in-progress download items.
 *
 * @returns The stored in-progress download items, or an empty array if no valid data is available.
 */
function read(): Promise<InflightItem[]> {
  return AsyncStorage.getItem(INFLIGHT_KEY)
    .then((raw) => {
      if (!raw) return [];
      const parsed = JSON.parse(raw) as InflightItem[];
      return Array.isArray(parsed) ? parsed : [];
    })
    .catch(() => []);
}

const write = (items: InflightItem[]): Promise<void> =>
  AsyncStorage.setItem(INFLIGHT_KEY, JSON.stringify(items)).catch(
    () => undefined
  );

const listeners = new Set<() => void>();

/**
 * Notifies all registered listeners of an in-flight download change.
 */
function emit(): void {
  listeners.forEach((fn) => fn());
}

/**
 * Subscribes to notifications when the in-flight download list changes.
 *
 * @param fn - The function to invoke when the list changes
 * @returns A function that removes the subscription
 */
export function subscribeInflight(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Adds or replaces an in-progress download and orders all items by most recent update.
 *
 * @param item - The in-progress download to add or replace
 */
export async function upsertInflight(item: InflightItem): Promise<void> {
  const items = await read();
  const next = [
    item,
    ...items.filter((it) => it.id !== item.id),
  ].sort((x, y) => y.updatedAt - x.updatedAt);
  await write(next);
  emit();
}

/**
 * Updates the progress of an in-flight download.
 *
 * @param id - The download identifier
 * @param progress - The progress value, clamped and rounded to a percentage from 0 to 100
 */
export async function updateInflightProgress(
  id: string,
  progress: number
): Promise<void> {
  const items = await read();
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  if (items[idx].progress === pct) return;
  items[idx] = { ...items[idx], progress: pct, updatedAt: Date.now() };
  await write(items);
  emit();
}

/**
 * Removes an in-progress download by its identifier.
 *
 * @param id - The identifier of the download to remove
 */
export async function removeInflight(id: string): Promise<void> {
  const items = await read();
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return;
  await write(next);
  emit();
}

/**
 * Provides the current in-progress downloads and a function to refresh them from storage.
 *
 * @returns The current download items and a function that refreshes the items
 */
export function useInflight(): {
  items: InflightItem[];
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<InflightItem[]>(memory);

  const refresh = async (): Promise<void> => {
    const fresh = await read();
    memory = fresh;
    setItems(fresh);
  };

  useEffect(() => {
    void refresh();
    return subscribeInflight(() => void refresh());
  }, []);

  return { items, refresh };
}
