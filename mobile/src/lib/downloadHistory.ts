import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const HISTORY_KEY = 'phantom.download.history';

export type HistoryItem = {
  id: string;
  title: string;
  author?: string;
  platform: string;
  ext: string;
  isAudio: boolean;
  thumbnail?: string;
  uri?: string;
  savedAt: number;
};

let memory: HistoryItem[] = [];
AsyncStorage.getItem(HISTORY_KEY)
  .then((raw) => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as HistoryItem[];
        if (Array.isArray(parsed)) memory = parsed;
      } catch {
        /* ignore */
      }
      memory = dedupeByUri(memory);
    }
    emit(memory);
  })
  .catch(() => {
    /* ignore */
  });

export function dedupeByUri(items: HistoryItem[]): HistoryItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.uri) return true;
    if (seen.has(it.uri)) return false;
    seen.add(it.uri);
    return true;
  });
}

function write(items: HistoryItem[]): Promise<void> {
  return AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items)).catch(
    () => undefined
  );
}

const listeners = new Set<(items: HistoryItem[]) => void>();

function emit(items: HistoryItem[]): void {
  listeners.forEach((fn) => fn(items));
}

function subscribeHistory(fn: (items: HistoryItem[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const MAX_ITEMS = 200;

function commit(items: HistoryItem[]): Promise<void> {
  memory = items;
  emit(items);
  return write(items);
}

export function addHistory(item: HistoryItem): Promise<void> {
  return commit(
    [item, ...memory.filter((it) => it.id !== item.id)].slice(0, MAX_ITEMS)
  );
}

export function removeHistory(id: string): Promise<void> {
  return commit(memory.filter((it) => it.id !== id));
}

export function restoreHistory(
  item: HistoryItem,
  index: number
): Promise<void> {
  const without = memory.filter((it) => it.id !== item.id);
  const at = Math.min(Math.max(0, index), without.length);
  return commit(
    [...without.slice(0, at), item, ...without.slice(at)].slice(0, MAX_ITEMS)
  );
}

export async function clearHistory(): Promise<void> {
  memory = [];
  emit([]);
  await AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined);
}

export function useDownloadHistory(): {
  items: HistoryItem[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<HistoryItem[]>(memory);
  const [loading, setLoading] = useState(memory.length === 0);

  const refresh = useCallback((): Promise<void> => {
    setItems([...memory]);
    setLoading(false);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount history refresh
    if (memory.length === 0) void refresh();
    return subscribeHistory((next) => {
      setItems(next);
      setLoading(false);
    });
  }, [refresh]);

  return { items, loading, refresh };
}
