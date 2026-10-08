import { useCallback, useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { setStatusBarHidden } from 'expo-status-bar';
import { log, error as logError } from '../lib/log';

export function useFullscreenLock() {
  const [fullscreen, setFullscreen] = useState(false);

  const enter = useCallback(() => {
    setFullscreen(true);
    log('Player', 'fullscreen on');
    setStatusBarHidden(true, 'fade');
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch((err: unknown) => {
      logError(
        'Player',
        `fullscreen lock failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
    void NavigationBar.setVisibilityAsync('hidden').catch(() => undefined);
  }, []);

  const exit = useCallback(() => {
    setFullscreen(false);
    log('Player', 'fullscreen off');
    setStatusBarHidden(false, 'fade');
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    )
      .catch((err: unknown) => {
        logError(
          'Player',
          `fullscreen unlock failed: ${err instanceof Error ? err.message : String(err)}`
        );
      })
      .finally(() => {
        void ScreenOrientation.unlockAsync().catch(() => undefined);
      });
    void NavigationBar.setVisibilityAsync('visible').catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      void ScreenOrientation.unlockAsync().catch(() => undefined);
      setStatusBarHidden(false, 'fade');
      void NavigationBar.setVisibilityAsync('visible').catch(() => undefined);
    },
    []
  );

  return { fullscreen, enter, exit };
}
