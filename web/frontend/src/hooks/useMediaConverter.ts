import { isHost } from '../lib/utils';
import { useCallback, useState, useEffect } from 'react';
import { useProgress } from './useProgress';
import { useNativeBridge } from './useNativeBridge';
import { useVideoInfo } from './useVideoInfo';
import { useDownloadOrchestrator } from './useDownloadOrchestrator';
import { useAppStore } from '../store/useAppStore';
import { VideoInfo, FinalResponse } from '@phantom/shared/schemas/media.schema';

export interface MediaConverterHook {
  url: string;
  setUrl: (url: string) => void;
  loading: boolean;
  error: string;
  progress: number;
  status: string;
  subStatus: string;
  desktopLogs: string[];
  selectedFormat: string;
  setSelectedFormat: (format: string) => void;
  isPickerOpen: boolean;
  setIsPickerOpen: (open: boolean) => void;
  videoData: VideoInfo | null;
  showPlayer: boolean;
  setShowPlayer: (show: boolean) => void;
  playerData: FinalResponse | null;
  videoTitle: string;
  isMobile: boolean;
  isSpotifySession: boolean;
  handleDownloadTrigger: (inputUrl?: string) => Promise<void>;
  handleDownload: (
    format?: string,
    quality?: string,
    metadata?: { title?: string; artist?: string; album?: string }
  ) => Promise<void>;
  cancelDownload: () => void;
  handlePaste: (input: string) => Promise<void>;
  requestClipboard: () => boolean;
}

export const useMediaConverter = (): MediaConverterHook => {
  // pull from store
  const url = useAppStore((state) => state.url);
  const setUrl = useAppStore((state) => state.setUrl);
  const loading = useAppStore((state) => state.loading);
  const setLoading = useAppStore((state) => state.setLoading);
  const error = useAppStore((state) => state.error);
  const setError = useAppStore((state) => state.setError);
  const selectedFormat = useAppStore((state) => state.selectedFormat);
  const setSelectedFormat = useAppStore((state) => state.setSelectedFormat);
  const showPlayer = useAppStore((state) => state.showPlayer);
  const setShowPlayer = useAppStore((state) => state.setShowPlayer);
  const playerData = useAppStore((state) => state.playerData);
  const setPlayerData = useAppStore((state) => state.setPlayerData);
  const videoTitle = useAppStore((state) => state.videoTitle);
  const setVideoTitle = useAppStore((state) => state.setVideoTitle);
  const videoData = useAppStore((state) => state.videoData);
  const setVideoData = useAppStore((state) => state.setVideoData);
  const isPickerOpen = useAppStore((state) => state.isPickerOpen);
  const setIsPickerOpen = useAppStore((state) => state.setIsPickerOpen);

  // sync store
  const {
    progress,
    status,
    subStatus,
    desktopLogs,
    setProgress,
    setTargetProgress,
    setStatus,
    setSubStatus,
    setDesktopLogs,
    setPendingSubStatuses,
  } = useProgress();

  const isSpotifySession =
    typeof url === 'string' && isHost(url, 'spotify.com');

  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    // skipcq: JS-0045
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // bridge
  const { requestClipboard } = useNativeBridge({
    setUrl,
    setLoading,
    setError,
    setProgress,
    setTargetProgress,
    setStatus,
    setSubStatus,
    setDesktopLogs,
    setPendingSubStatuses,
    setVideoTitle,
    setIsPickerOpen,
    setVideoData,
    setShowPlayer,
    setPlayerData,
    isPickerOpen,
  });

  // actions
  const { fetchInfo } = useVideoInfo();
  const { startDownload, cancelDownload } = useDownloadOrchestrator();

  const handlePaste = useCallback(
    async (input: string): Promise<void> => {
      if (input) {
        setUrl(input);
        await fetchInfo(input);
      }
    },
    [fetchInfo, setUrl]
  );

  const wrappedDownload = useCallback(
    async (
      format?: string,
      quality?: string,
      metadata?: Record<string, string | undefined>
    ) => {
      await startDownload(quality || 'mp3', {
        ...metadata,
        extension: format,
      });
    },
    [startDownload]
  );

  return {
    url,
    setUrl,
    loading,
    error,
    progress,
    status,
    subStatus,
    desktopLogs,
    selectedFormat,
    setSelectedFormat,
    isPickerOpen,
    setIsPickerOpen,
    videoData,
    showPlayer,
    setShowPlayer,
    playerData,
    videoTitle,
    isMobile,
    isSpotifySession,
    handleDownloadTrigger: fetchInfo,
    handleDownload: wrappedDownload,
    cancelDownload,
    handlePaste,
    requestClipboard,
  };
};
