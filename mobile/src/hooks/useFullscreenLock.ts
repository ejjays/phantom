import { useCallback, useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { setStatusBarHidden } from 'expo-status-bar';
import { log, error as logError } from '../lib/log';

async function setImmersive(hidden: boolean): Promise<void> {
  setStatusBarHidden(hidden, 'fade');
  await NavigationBar.setVisibilityAsync(hidden ? 'hidden' : 'visible');
}

export function useFullscreenLock() {
  const [fullscreen, setFullscreen] = useState(false);

  const enter = useCallback(async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      await setImmersive(true);
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
      await setImmersive(false);
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
      void setImmersive(false).catch(() => undefined);
    },
    []
  );

  return { fullscreen, enter, exit };
}
