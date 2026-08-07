import { isHost } from '../lib/utils';
import { useCallback, useState, useEffect } from 'react';
import { useProgress } from './useProgress';
import { useNativeBridge } from './useNativeBridge';
import { useVideoInfo } from './useVideoInfo';
import { useDownloadOrchestrator } from './useDownloadOrchestrator';
import { useRemixStore } from '../store/useRemixStore';
import { VideoInfo, FinalResponse } from '@shared/schemas/media.schema.js';

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
  const url = useRemixStore((state) => state.url);
  const setUrl = useRemixStore((state) => state.setUrl);
  const loading = useRemixStore((state) => state.loading);
  const setLoading = useRemixStore((state) => state.setLoading);
  const error = useRemixStore((state) => state.error);
  const setError = useRemixStore((state) => state.setError);
  const selectedFormat = useRemixStore((state) => state.selectedFormat);
  const setSelectedFormat = useRemixStore((state) => state.setSelectedFormat);
  const showPlayer = useRemixStore((state) => state.showPlayer);
  const setShowPlayer = useRemixStore((state) => state.setShowPlayer);
  const playerData = useRemixStore((state) => state.playerData);
  const setPlayerData = useRemixStore((state) => state.setPlayerData);
  const videoTitle = useRemixStore((state) => state.videoTitle);
  const setVideoTitle = useRemixStore((state) => state.setVideoTitle);
  const videoData = useRemixStore((state) => state.videoData);
  const setVideoData = useRemixStore((state) => state.setVideoData);
  const isPickerOpen = useRemixStore((state) => state.isPickerOpen);
  const setIsPickerOpen = useRemixStore((state) => state.setIsPickerOpen);

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
