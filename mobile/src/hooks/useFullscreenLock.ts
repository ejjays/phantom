import { useCallback, useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { log, error as logError } from '../lib/log';

export function useFullscreenLock() {
  const [fullscreen, setFullscreen] = useState(false);

  const enter = useCallback(async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      setFullscreen(true);
      log('Player', 'fullscreen on');
    } catch (err) {
      logError(
        'Player',
        `fullscreen lock failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      await ScreenOrientation.unlockAsync();
    } catch (err) {
      logError(
        'Player',
        `fullscreen unlock failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setFullscreen(false);
      log('Player', 'fullscreen off');
    }
  }, []);

  useEffect(
    () => () => {
      void ScreenOrientation.unlockAsync().catch(() => undefined);
    },
    []
  );

  return { fullscreen, enter, exit };
}
