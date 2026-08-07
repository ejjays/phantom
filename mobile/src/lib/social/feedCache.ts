import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FeedData } from '../../screens/UpdatesScreen';

const FEED_KEY = 'phantom.updates.feed';

let memory: FeedData | null = null;

void readFeedCache().then((data) => {
  memory = data;
});

export function getFeedCache(): FeedData | null {
  return memory;
}

function readFeedCache(): Promise<FeedData | null> {
  return AsyncStorage.getItem(FEED_KEY)
    .then((raw) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FeedData;
      return Array.isArray(parsed?.updates) ? parsed : null;
    })
    .catch(() => null);
}

export function writeFeedCache(data: FeedData): Promise<void> {
  memory = data;
  return AsyncStorage.setItem(FEED_KEY, JSON.stringify(data)).catch(
    () => undefined
  );
}
