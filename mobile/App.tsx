import { useState, useRef, useEffect, useCallback } from 'react';
import { View, StatusBar, InteractionManager, AppState } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import tw from './src/lib/tw';
import TwinkleStars from './src/components/backgrounds/TwinkleStars';
import ShootingStars from './src/components/backgrounds/ShootingStars';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BottomNav from './src/components/BottomNav';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import UpdatesScreen from './src/screens/UpdatesScreen';
import DownloadsScreen from './src/screens/DownloadsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PlaylistScreen from './src/screens/PlaylistScreen';
import { type DownloadMode } from './src/components/FormatBar';
import { resolve } from './src/extractors';
import { prewarmClientId } from './src/extractors/soundcloud';
import { Format, VideoInfo, ExtractorError } from './src/extractors/types';
import PickerModal from './src/components/PickerModal';
import SpotifyPickerModal from './src/components/SpotifyPickerModal';
import NotificationPermissionSheet from './src/components/sheets/NotificationPermissionSheet';
import DownloadSuccessSheet from './src/components/sheets/DownloadSuccessSheet';
import ErrorSheet from './src/components/sheets/ErrorSheet';
import YouTubeExtractorWebView from './src/components/webviews/YouTubeExtractorWebView';
import InstagramExtractorWebView from './src/components/webviews/InstagramExtractorWebView';
import ErrorBoundary from './src/components/ErrorBoundary';
import { type DownloadMeta } from './src/lib/format';
import { getOnboarded, setOnboarded, getAutoPaste } from './src/lib/settings';
import { addDownloadTapListener } from './src/lib/notify';
import { registerDownloadService } from './src/lib/fgservice';
import { initPush } from './src/lib/social/push';
import { addSocialTapListener } from './src/lib/social/pushRender';
import { type SocialDeepLink } from './src/lib/social/notificationTap.logic';
import { openSavedTarget } from './src/lib/download/gallery';
import { addHistory } from './src/lib/downloadHistory';
import { useDownload } from './src/hooks/useDownload';
import { useClipboardPaste } from './src/hooks/useClipboardPaste';
import { useNotificationPriming } from './src/hooks/useNotificationPriming';
import { tapImpact, loadHaptics } from './src/lib/haptics';
import { log, error as logError } from './src/lib/log';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import IBMPlexMonoRegular from './assets/fonts/IBMPlexMono-Regular.ttf';
import IBMPlexMonoMedium from './assets/fonts/IBMPlexMono-Medium.ttf';
import { VideoSplashScreen } from './src/components/VideoSplashScreen';
import IBMPlexMonoSemiBold from './assets/fonts/IBMPlexMono-SemiBold.ttf';
import IBMPlexMonoBold from './assets/fonts/IBMPlexMono-Bold.ttf';
import RubikRegular from './assets/fonts/Rubik-Regular.ttf';
import RubikMedium from './assets/fonts/Rubik-Medium.ttf';
import RubikSemiBold from './assets/fonts/Rubik-SemiBold.ttf';
import RubikBold from './assets/fonts/Rubik-Bold.ttf';
const queryClient = new QueryClient();
void SplashScreen.preventAutoHideAsync();
const SUCCESS_HANDOFF_MS = 280;
function cleanUrl(raw: string): string {
  return raw.trim().replace(/^['"\s]+|['"\s]+$/gu, '');
}
function AppRoot() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexMono: IBMPlexMonoRegular,
    'IBMPlexMono-Medium': IBMPlexMonoMedium,
    'IBMPlexMono-SemiBold': IBMPlexMonoSemiBold,
    'IBMPlexMono-Bold': IBMPlexMonoBold,
    Rubik: RubikRegular,
    'Rubik-Medium': RubikMedium,
    'Rubik-SemiBold': RubikSemiBold,
    'Rubik-Bold': RubikBold,
  });
  const [tab, setTab] = useState<'home' | 'downloads' | 'settings' | 'updates'>(
    'home'
  );
  const [visited, setVisited] = useState({
    downloads: false,
    settings: false,
    updates: false,
  });
  const [deepLink, setDeepLink] = useState<SocialDeepLink | null>(null);
  const [navHidden, setNavHidden] = useState(false);
  const [bgReady, setBgReady] = useState(false);
  const [showVideoSplash, setShowVideoSplash] = useState(true);
  const [onboarded, setOnboardedState] = useState<boolean | null>(null);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [playlistInfo, setPlaylistInfo] = useState<VideoInfo | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const { downloads, startDownload, clearDownloads } = useDownload(info);
  const [mode, setMode] = useState<DownloadMode>('mp4');
  const dismissedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    isAudio: boolean;
    uri?: string;
  }>({ isAudio: false });
  const successRef = useRef<{ isAudio: boolean; uri?: string }>({
    isAudio: false,
  });
  const { paste, readClipboard } = useClipboardPaste(setLink);
  const notifPriming = useNotificationPriming(onboarded === true);
  useEffect(() => {
    void getOnboarded().then(setOnboardedState);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (tab !== 'home' || link.trim()) return;
      void (async () => {
        const enabled = await getAutoPaste();
        if (!enabled) return;
        const text = await readClipboard();
        if (text) setLink(text);
      })();
    });
    return () => sub.remove();
  }, [tab, link, readClipboard]);
  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setInfo(null);
    setLink('');
    clearDownloads();
    dismissedRef.current = false;
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    setRefreshing(false);
  };
  useEffect(() => {
    registerDownloadService();
    loadHaptics();
    prewarmClientId();
    void initPush();
    const unsubscribe = addDownloadTapListener(() => {
      void openSavedTarget(successRef.current);
    });
    const unsubscribeSocial = addSocialTapListener((link) => {
      setTab('updates');
      setVisited((v) => (v.updates ? v : { ...v, updates: true }));
      setDeepLink(link);
    });
    return () => {
      unsubscribe();
      unsubscribeSocial();
    };
  }, []);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() =>
      setBgReady(true)
    );
    return () => task.cancel();
  }, []);
  const handleResolve = async () => {
    if (!link.trim() || loading) return;
    tapImpact();
    const url = cleanUrl(link);
    dismissedRef.current = false;
    setLoading(true);
    setError(null);
    setInfo(null);
    clearDownloads();
    log('Resolve', url);
    try {
      const result = await resolve(url, (partial) => {
        if (!dismissedRef.current) setInfo(partial);
      });
      if (!result) {
        if (!dismissedRef.current) {
          setInfo(null);
          setError({
            message: 'No video found, or this link is not supported yet.',
            canRetry: true,
          });
        }
        return;
      }
      if (result.playlist) {
        setPlaylistInfo(result);
        setPlaylistOpen(true);
        return;
      }
      if (!dismissedRef.current) setInfo(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      const canRetry = !(e instanceof ExtractorError) || e.retryable;
      logError('Resolve', `failed: ${message}`);
      if (!dismissedRef.current) {
        setInfo(null);
        setError({ message, canRetry });
      }
    } finally {
      setLoading(false);
    }
  };
  const handlePlaylistClose = useCallback(() => {
    setPlaylistOpen(false);
    setPlaylistInfo(null);
  }, []);
  const closePicker = () => {
    dismissedRef.current = true;
    setInfo(null);
  };
  const onDownload = async (format: Format, meta?: DownloadMeta) => {
    setError(null);
    const result = await startDownload(format, meta);
    if (result.status === 'error') {
      setError({ message: result.message, canRetry: true });
      return;
    }
    if (result.status === 'saved') {
      closePicker();
      const isAudio = format.isAudio && !format.isVideo;
      const target = { isAudio, uri: result.uri };
      setSuccessInfo(target);
      successRef.current = target;
      void addHistory({
        id: `${info?.extractorKey}:${info?.id}:${format.formatId}`,
        title: meta?.title?.trim() || info?.title || 'Download',
        author: meta?.author?.trim() || info?.uploader,
        platform: info?.extractorKey || 'unknown',
        ext: format.extension || (isAudio ? 'm4a' : 'mp4'),
        isAudio,
        thumbnail: info?.thumbnail,
        uri: result.uri,
        savedAt: Date.now(),
      });
      setTimeout(() => setSuccessOpen(true), SUCCESS_HANDOFF_MS);
    }
  };
  const goTab = (next: 'home' | 'downloads' | 'settings' | 'updates') => {
    setTab(next);
    if (next === 'downloads' || next === 'settings' || next === 'updates') {
      setVisited((v) => (v[next] ? v : { ...v, [next]: true }));
    }
  };
  const onLayoutRoot = useCallback(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) {
    return null;
  }
  if (!fontsLoaded && !fontError) {
    return null;
  }
  return (
    <QueryClientProvider client={queryClient}>
      {showVideoSplash && (
        <VideoSplashScreen onFinish={() => setShowVideoSplash(false)} />
      )}
      <GestureHandlerRootView style={tw`flex-1 bg-background`}>
        <KeyboardProvider preload>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <SafeAreaView
              style={tw`flex-1 bg-background`}
              onLayout={onLayoutRoot}
            >
              <StatusBar barStyle="light-content" backgroundColor="#030014" />
              {bgReady && (
                <Animated.View
                  entering={FadeIn.duration(450)}
                  pointerEvents="none"
                  style={tw`absolute inset-0`}
                >
                  {tab === 'home' && <TwinkleStars />}
                  {tab === 'home' && <ShootingStars />}
                </Animated.View>
              )}
              <View
                style={[tw`flex-1`, { opacity: tab === 'home' ? 1 : 0 }]}
                pointerEvents={tab === 'home' ? 'auto' : 'none'}
              >
                <HomeScreen
                  link={link}
                  onChangeLink={setLink}
                  loading={loading}
                  mode={mode}
                  setMode={setMode}
                  onResolve={handleResolve}
                  onPaste={paste}
                  onInputFocus={() => {}}
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                />
              </View>
              {visited.settings && (
                <SettingsScreen
                  visible={tab === 'settings'}
                  onFullScreen={setNavHidden}
                />
              )}
              {visited.downloads && (
                <DownloadsScreen visible={tab === 'downloads'} />
              )}
              {visited.updates && (
                <UpdatesScreen
                  visible={tab === 'updates'}
                  onFullScreen={setNavHidden}
                  deepLink={deepLink}
                  onDeepLinkHandled={() => setDeepLink(null)}
                />
              )}
              <BottomNav onChange={goTab} hidden={navHidden || playlistOpen} />
              {playlistOpen && playlistInfo ? (
                <PlaylistScreen
                  info={playlistInfo}
                  visible={playlistOpen}
                  onClose={handlePlaylistClose}
                />
              ) : null}
              {info?.extractorKey === 'spotify' ? (
                <SpotifyPickerModal
                  info={info}
                  visible={!!info}
                  downloads={downloads}
                  onClose={closePicker}
                  onDownload={onDownload}
                />
              ) : (
                <PickerModal
                  info={info}
                  downloads={downloads}
                  preferAudio={mode === 'mp3'}
                  onClose={closePicker}
                  onDownload={onDownload}
                />
              )}
              <DownloadSuccessSheet
                open={successOpen}
                onClose={() => setSuccessOpen(false)}
                isAudio={successInfo.isAudio}
                onOpen={() => {
                  void openSavedTarget(successInfo);
                  setSuccessOpen(false);
                }}
              />
              <ErrorSheet
                open={!!error}
                message={error?.message ?? ''}
                onClose={() => setError(null)}
                onRetry={() => {
                  void handleResolve();
                }}
                canRetry={error?.canRetry ?? true}
              />
              <YouTubeExtractorWebView />
              <InstagramExtractorWebView />
              <NotificationPermissionSheet
                visible={notifPriming.visible}
                onAllow={notifPriming.allow}
                onDismiss={notifPriming.dismiss}
              />
            </SafeAreaView>
            {onboarded === false && (
              <Animated.View
                exiting={FadeOut.duration(500)}
                style={[tw`absolute inset-0`, { elevation: 100, zIndex: 100 }]}
              >
                <OnboardingScreen
                  onDone={() => {
                    setOnboardedState(true);
                    void setOnboarded(true);
                  }}
                />
              </Animated.View>
            )}
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
