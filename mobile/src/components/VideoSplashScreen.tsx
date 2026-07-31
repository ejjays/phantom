import { useRef, useEffect, useState, useCallback } from 'react';
import { StyleSheet, Dimensions, ViewStyle } from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import Animated, { FadeOut } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { File, Paths } from 'expo-file-system';

type Props = {
  onFinish: () => void;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const VIDEO_WIDTH = 944;
const VIDEO_HEIGHT = 992;
const VIDEO_ASPECT = VIDEO_WIDTH / VIDEO_HEIGHT;
const SCREEN_ASPECT = SCREEN_WIDTH / SCREEN_HEIGHT;

const videoStyle = (() => {
  if (SCREEN_ASPECT > VIDEO_ASPECT) {
    const height = SCREEN_HEIGHT;
    const width = height * VIDEO_ASPECT;
    return { width, height };
  } else {
    const width = SCREEN_WIDTH;
    const height = width / VIDEO_ASPECT;
    return { width, height };
  }
})();

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  } as ViewStyle,
  video: videoStyle as ViewStyle,
});

const HOLD_LAST_FRAME_MS = 500;
const SPLASH_VIDEO_URL =
  'https://fiiaupihpiujgorgagzp.supabase.co/storage/v1/object/public/assets/splash.mp4';

export function VideoSplashScreen({ onFinish }: Props) {
  const [visible, setVisible] = useState(true);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(false);
  const videoRef = useRef<VideoRef>(null);
  const finishedRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setVisible(false);
    setTimeout(onFinish, 300);
  }, [onFinish]);

  useEffect(() => {
    (async () => {
      try {
        const cacheFile = new File(Paths.cache, 'splash.mp4');
        await File.downloadFileAsync(SPLASH_VIDEO_URL, cacheFile, {
          idempotent: true,
        });
        setVideoUri(cacheFile.uri);
        void SplashScreen.hideAsync();
      } catch (err) {
        console.error('VideoSplashScreen error:', err);
        await SplashScreen.hideAsync();
        setError(true);
        doFinish();
      }
    })();
  }, [doFinish]);

  const handleEnd = () => {
    setPaused(true);
    setTimeout(() => {
      doFinish();
    }, HOLD_LAST_FRAME_MS);
  };

  const handleError = () => {
    console.error('Video playback error');
    setError(true);
    try {
      new File(Paths.cache, 'splash.mp4').delete();
    } catch {
      /* ignore */
    }
    doFinish();
  };

  useEffect(() => {
    fallbackTimerRef.current = setTimeout(() => {
      if (visible && !finishedRef.current) {
        console.log('VideoSplashScreen timeout');
        doFinish();
      }
    }, 10000);
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [visible, doFinish]);

  if (!visible) return null;

  return (
    <Animated.View
      exiting={FadeOut.duration(300)}
      style={styles.container}
      pointerEvents="none"
    >
      {videoUri && !error && (
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode="contain"
          onEnd={handleEnd}
          onError={handleError}
          playWhenInactive={false}
          playInBackground={false}
          ignoreSilentSwitch="obey"
          repeat={false}
          muted
          paused={paused}
        />
      )}
    </Animated.View>
  );
}
