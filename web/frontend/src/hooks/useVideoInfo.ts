import { useCallback } from 'react';
import { useRemixStore } from '../store/useRemixStore';
import { VideoInfo, FinalResponse } from '@shared/schemas/media.schema.js';
import { filterUnsupportedCodecs } from '../lib/codec-support';
import { resolve, initializeResolver } from '../lib/extractors';
import { PROXY_BASE } from '../lib/config';

const _getCleanedUrl = (url: string) => {
  let cleaned = url;
  if (cleaned.includes('%')) {
    try {
      const decoded = decodeURIComponent(cleaned);
      if (decoded.startsWith('http')) cleaned = decoded;
    } catch (_e) {
      /* ignore */
    }
  }
  return cleaned.split('&id=')[0].split('?id=')[0];
};

const _handleFetchError = async (response: Response) => {
  let errorMsg = 'Failed to fetch video details';
  try {
    const errJson = await response.json();
    if (errJson.error) errorMsg = errJson.error;
  } catch (_e) {
    /* ignore */
  }
  throw new Error(`${errorMsg} (${response.status})`);
};

export const useVideoInfo = () => {
  const clientId = useRemixStore((state) => state.clientId);
  initializeResolver(PROXY_BASE);
  const url = useRemixStore((state) => state.url);
  const setVideoData = useRemixStore((state) => state.setVideoData);
  const setIsPickerOpen = useRemixStore((state) => state.setIsPickerOpen);
  const setDownloadStarted = useRemixStore((state) => state.setDownloadStarted);
  const setStatus = useRemixStore((state) => state.setStatus);
  const setTargetProgress = useRemixStore((state) => state.setTargetProgress);
  const setSubStatus = useRemixStore((state) => state.setSubStatus);
  const setPendingSubStatuses = useRemixStore(
    (state) => state.setPendingSubStatuses
  );
  const setDesktopLogs = useRemixStore((state) => state.setDesktopLogs);
  const setSessionStartTime = useRemixStore(
    (state) => state.setSessionStartTime
  );
  const setLoading = useRemixStore((state) => state.setLoading);
  const setError = useRemixStore((state) => state.setError);
  const setSelectedFormat = useRemixStore((state) => state.setSelectedFormat);
  const setPlayerData = useRemixStore((state) => state.setPlayerData);
  const setShowPlayer = useRemixStore((state) => state.setShowPlayer);

  const _handleSpotifyPlayer = useCallback(
    (updatedData: VideoInfo, finalUrl: string, data: VideoInfo) => {
      const spotify = updatedData.spotifyMetadata;
      if (spotify?.previewUrl) {
        setSelectedFormat('mp3');
        setPlayerData({
          ...updatedData,
          id: spotify.id || updatedData.id,
          title: spotify.title || updatedData.title,
          artist: spotify.artist || updatedData.artist,
          uploader: spotify.artist || updatedData.uploader,
          album: spotify.album || updatedData.album || '',
          cover:
            spotify.cover ||
            spotify.imageUrl ||
            updatedData.cover ||
            '/logo.webp',
          thumbnail:
            spotify.thumbnail ||
            spotify.imageUrl ||
            updatedData.thumbnail ||
            updatedData.cover ||
            '/logo.webp',
          previewUrl: spotify.previewUrl,
          formats: updatedData.formats || [],
          audioFormats: updatedData.audioFormats || [],
          isPartial: updatedData.isPartial || false,
          isIsrcMatch: data.isIsrcMatch || false,
          webpageUrl: data.webpageUrl || finalUrl,
        } as FinalResponse);
        setShowPlayer(true);
      }
    },
    [setSelectedFormat, setPlayerData, setShowPlayer]
  );

  const fetchInfo = useCallback(
    async (inputUrl?: string) => {
      const finalUrl = typeof inputUrl === 'string' ? inputUrl : url;
      if (!finalUrl || typeof finalUrl !== 'string') return;

      const cleanedUrl = _getCleanedUrl(finalUrl);

      setLoading(true);
      setError('');

      if (useRemixStore.getState().videoData?.webpageUrl !== cleanedUrl) {
        setVideoData(null);
      }

      setIsPickerOpen(false);
      setDownloadStarted(false);
      setStatus('fetching_info');
      setTargetProgress(10);
      setSubStatus('Initializing Engine...');
      setPendingSubStatuses([]);
      setSessionStartTime(Date.now());
      setDesktopLogs(['[0:00] Initializing Phantom Core Engine...']);

      try {
        const onPartial = (partial: Partial<VideoInfo>) => {
          setVideoData((prev: VideoInfo | null) => {
            const prevFormats = Array.isArray(prev?.formats)
              ? (prev?.formats ?? [])
              : [];
            const prevAudio = Array.isArray(prev?.audioFormats)
              ? (prev?.audioFormats ?? [])
              : [];
            return {
              ...(prev || ({} as VideoInfo)),
              ...partial,
              formats: partial.formats || prevFormats,
              audioFormats: partial.audioFormats || prevAudio,
              isPartial:
                partial.isPartial !== undefined
                  ? partial.isPartial
                  : (prev?.isPartial ?? false),
              webpageUrl: partial.webpageUrl || cleanedUrl,
              extractorKey: partial.extractorKey || prev?.extractorKey,
            } as VideoInfo;
          });
          if (partial.title && partial.id) {
            setIsPickerOpen(true);
          }
        };

        const resolved = await resolve(cleanedUrl, onPartial);
        if (!resolved) {
          throw new Error(
            'Unsupported URL - only YouTube, Spotify and X are supported in the browser'
          );
        }

        const updatedData = resolved;

        setVideoData((prev: VideoInfo | null) => {
          const newFormats = Array.isArray(updatedData.formats)
            ? updatedData.formats
            : [];
          const newAudioFormats = Array.isArray(updatedData.audioFormats)
            ? updatedData.audioFormats
            : [];
          const prevFormats = Array.isArray(prev?.formats)
            ? (prev?.formats ?? [])
            : [];
          const prevAudioFormats = Array.isArray(prev?.audioFormats)
            ? (prev?.audioFormats ?? [])
            : [];
          const finalFormats =
            newFormats.length >= prevFormats.length ? newFormats : prevFormats;
          const finalAudioFormats =
            newAudioFormats.length >= prevAudioFormats.length
              ? newAudioFormats
              : prevAudioFormats;
          const hasFormats = finalFormats.length > 0;
          return {
            ...prev,
            ...updatedData,
            formats: filterUnsupportedCodecs(finalFormats),
            audioFormats: finalAudioFormats,
            isPartial:
              updatedData.isPartial !== undefined
                ? updatedData.isPartial && !hasFormats
                : !hasFormats,
            previewUrl:
              updatedData.previewUrl ||
              updatedData.spotifyMetadata?.previewUrl ||
              prev?.previewUrl,
          } as VideoInfo;
        });

        if (updatedData.title && updatedData.title !== 'Unknown') {
          setIsPickerOpen(true);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [
      url,
      clientId,
      setStatus,
      setTargetProgress,
      setSubStatus,
      setPendingSubStatuses,
      setDesktopLogs,
      setLoading,
      setError,
      setVideoData,
      setIsPickerOpen,
      setDownloadStarted,
      setSessionStartTime,
      _handleSpotifyPlayer,
    ]
  );

  return { fetchInfo };
};
