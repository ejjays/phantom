import React, {
  useLayoutEffect,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRemixStore } from './store/useRemixStore';
import { VideoInfo } from '@shared/schemas/media.schema.js';
import { getDynamicBackendUrl } from './lib/config';
import { SSEService } from './lib/sse.service';
import { handleSseMessage } from './hooks/useSSE';
import Layout from './components/Layout';

// lazy load pages
const DocsLayout = lazy(() => import('./components/docs/DocsLayout'));
const MainContent = lazy(() => import('./components/MainContent'));
const SongKeyChanger = lazy(() => import('./pages/Tools/SongKeyChanger'));
const RemixLab = lazy(() => import('./pages/Tools/RemixLab'));
const FormatGuide = lazy(() => import('./pages/Guide/FormatGuide'));
const AboutPage = lazy(() => import('./pages/About/AboutPage'));
const SecurityPrivacy = lazy(() => import('./pages/Guide/SecurityPrivacy'));
const VideoGuide = lazy(() => import('./pages/Guide/VideoGuide'));
const ArchitectureDeepDive = lazy(
  () => import('./pages/Guide/ArchitectureDeepDive')
);
const TechStack = lazy(() => import('./pages/Guide/TechStack'));
const RemixLabGuide = lazy(() => import('./pages/Guide/RemixLabGuide'));
const UpdatesPage = lazy(() => import('./pages/Updates/UpdatesPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.scrollTo(0, 0);
    }
  }, [pathname]);

  return null;
};

const RemixLabRoute = () => {
  const handleExit = useCallback(() => {
    window.location.href = '/';
  }, []);

  return <RemixLab onExit={handleExit} />;
};

const App = () => {
  const backendUrl = useRemixStore((state) => state.backendUrl);
  const setBackendUrl = useRemixStore((state) => state.setBackendUrl);
  const clientId = useRemixStore((state) => state.clientId);
  const location = useLocation();

  const sseRef = useRef<SSEService | null>(null);

  // set remote url
  useEffect(() => {
    let mounted = true;
    console.log('[App] initiating backend discovery...');
    getDynamicBackendUrl()
      .then((url) => {
        console.log(
          '[App] backend discovery result:',
          url || '(empty/null — SSE will not start)'
        );
        if (url && mounted) setBackendUrl(url);
      })
      .catch((err) => {
        console.error('[App] backend discovery threw:', err);
      });
    return () => {
      mounted = false;
    };
  }, [setBackendUrl]);

  // manage sse
  useEffect(
    function () {
      console.log(
        '[App] SSE effect run — backendUrl:',
        backendUrl || '(empty)',
        'clientId:',
        clientId || '(empty)',
        'pathname:',
        location.pathname
      );
      if (
        !backendUrl ||
        !clientId ||
        !location.pathname.includes('/tools/remix-lab')
      ) {
        console.log(
          '[App] SSE effect bailed — waiting for backendUrl + clientId'
        );
        return;
      }

      // disconnect SSE
      if (location.pathname.includes('/tools/remix-lab')) {
        if (sseRef.current) {
          sseRef.current.disconnect();
          sseRef.current = null;
        }
        return;
      }

      if (sseRef.current) {
        console.log('[App] SSE already connected, skipping');
        return;
      }

      const sse = new SSEService();
      sseRef.current = sse;
      let mounted = true;
      let reconnectTimeout: number | null = null;

      const connect = async () => {
        if (!mounted) return;

        const sseUrl = `${backendUrl}/events?id=${clientId}`;
        console.log('[App] SSE connecting to:', sseUrl);

        try {
          await sse.connect(
            sseUrl,
            (data: unknown) => {
              if (!mounted) return;

              const event = data as { status?: string };
              // track session start
              if (
                (event.status === 'fetching_info' ||
                  event.status === 'initializing') &&
                !useRemixStore.getState().sessionStartTime
              ) {
                useRemixStore.getState().setSessionStartTime(Date.now());
              }

              handleSseMessage(data as Record<string, unknown>, '', {
                setStatus: (s: string) => useRemixStore.getState().setStatus(s),
                setVideoData: (v: unknown) =>
                  useRemixStore.getState().setVideoData(v as VideoInfo),
                setIsPickerOpen: (o: boolean) =>
                  useRemixStore.getState().setIsPickerOpen(o),
                setPendingSubStatuses: (payload: unknown) =>
                  useRemixStore
                    .getState()
                    .setPendingSubStatuses(payload as string[]),
                setDesktopLogs: (payload: unknown) =>
                  useRemixStore.getState().setDesktopLogs(payload as string[]),
                setTargetProgress: (tp: unknown) =>
                  useRemixStore.getState().setTargetProgress(tp as number),
                setProgress: (progress: unknown) =>
                  useRemixStore.getState().setProgress(progress as number),
                setSubStatus: (ss: string) =>
                  useRemixStore.getState().setSubStatus(ss),
                getTS: () => {
                  const start = useRemixStore.getState().sessionStartTime;
                  if (!start) return '[0:00]';
                  const elapsed = Math.floor((Date.now() - start) / 1000);
                  const mins = Math.floor(elapsed / 60);
                  const secs = elapsed % 60;
                  return `[${mins}:${secs.toString().padStart(2, '0')}]`;
                },
              });
            },
            (err: unknown) => {
              if (!mounted) return;
              const error = err as { message?: string };
              console.error('[SSE] Error:', error.message);
              if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
              reconnectTimeout = window.setTimeout(connect, 3000);
            },
            () => {
              if (!mounted) return;
              console.log('[SSE] Connected');
            }
          );
        } catch (_e) {
          if (mounted) {
            if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
            reconnectTimeout = window.setTimeout(connect, 3000);
          }
        }
      };

      function initSse(): void {
        connect();
      }
      initSse();

      // skipcq: JS-0045
      return () => {
        mounted = false;
        if (reconnectTimeout) {
          window.clearTimeout(reconnectTimeout);
        }
        sse.disconnect();
        sseRef.current = null;
      };
    },
    [backendUrl, clientId, location.pathname]
  );

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-cyan-500 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route
            path="/"
            element={
              <Layout>
                <MainContent />
              </Layout>
            }
          />
          <Route
            path="/updates"
            element={
              <Layout>
                <UpdatesPage />
              </Layout>
            }
          />
          <Route path="/tools/key-changer" element={<SongKeyChanger />} />
          <Route path="/tools/remix-lab" element={<RemixLabRoute />} />

          <Route
            element={
              <DocsLayout>
                <Outlet />
              </DocsLayout>
            }
          >
            <Route path="/resources/story" element={<AboutPage />} />
            <Route
              path="/resources/architecture"
              element={<ArchitectureDeepDive />}
            />
            <Route path="/resources/stack" element={<TechStack />} />
            <Route path="/resources/audio-guide" element={<FormatGuide />} />
            <Route path="/resources/video-guide" element={<VideoGuide />} />
            <Route path="/resources/security" element={<SecurityPrivacy />} />
            <Route path="/resources/remix-guide" element={<RemixLabGuide />} />
          </Route>

          <Route
            path="/about"
            element={<Navigate to="/resources/story" replace />}
          />
          <Route
            path="/guide/architecture"
            element={<Navigate to="/resources/architecture" replace />}
          />
          <Route
            path="/guide/formats"
            element={<Navigate to="/resources/audio-guide" replace />}
          />
          <Route
            path="/guide/video"
            element={<Navigate to="/resources/video-guide" replace />}
          />
          <Route
            path="/guide/security"
            element={<Navigate to="/resources/security" replace />}
          />
          <Route
            path="/guide/stack"
            element={<Navigate to="/resources/stack" replace />}
          />

          <Route
            path="/docs/story"
            element={<Navigate to="/resources/story" replace />}
          />
          <Route
            path="/docs/architecture"
            element={<Navigate to="/resources/architecture" replace />}
          />
          <Route
            path="/docs/audio-guide"
            element={<Navigate to="/resources/audio-guide" replace />}
          />
          <Route
            path="/docs/video-guide"
            element={<Navigate to="/resources/video-guide" replace />}
          />
          <Route
            path="/docs/security"
            element={<Navigate to="/resources/security" replace />}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
};

export default App;
