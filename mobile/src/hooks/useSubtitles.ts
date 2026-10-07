import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVidloveSubtitles, vidloveHeaders } from '../extractors/movies/vidlove';
import type { MovieRef } from '../extractors/movies/parse';
import {
  cueAt,
  fetchVttText,
  fitCuesToDuration,
  parseVtt,
  pickTrack,
  type SubtitleCue,
  type SubtitleTrack,
} from '../lib/subtitles';
import { log } from '../lib/log';

export function useSubtitles(
  ref: MovieRef | null,
  videoSec: number,
  showCaptions: boolean
) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const cues = useRef<SubtitleCue[]>([]);
  const key =
    ref === null
      ? ''
      : ref.kind === 'tv'
        ? `${ref.kind}/${ref.tmdbId}/${ref.season}/${ref.episode}`
        : `${ref.kind}/${ref.tmdbId}`;

  const trackKey = tracks.map((track) => track.url).join('|');

  // track discovery always runs: the cc button needs it to be enabled, and
  // only the vtt payload waits for the viewer to actually want captions
  useEffect(() => {
    cues.current = [];
    setTracks([]);
    setLabel(null);
    setLine(null);
    if (!ref) return undefined;
    let cancelled = false;
    void (async () => {
      const found = await fetchVidloveSubtitles(ref).catch(() => []);
      if (cancelled) return;
      if (found.length === 0) {
        log('Subtitles', `no tracks for ${key}`);
        return;
      }
      setTracks(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ref]);

  useEffect(() => {
    cues.current = [];
    setLine(null);
    if (!ref || !showCaptions || tracks.length === 0) return undefined;
    let cancelled = false;
    void (async () => {
      const chosen = pickTrack(tracks, 'en') ?? tracks[0];
      if (!chosen) return;
      const text = await fetchVttText(chosen.url, vidloveHeaders(ref)).catch(() => null);
      if (cancelled || !text) return;
      const parsed = fitCuesToDuration(parseVtt(text), videoSec);
      if (parsed.length === 0) {
        log('Subtitles', `empty track ${chosen.label} for ${key}`);
        return;
      }
      cues.current = parsed;
      setLabel(chosen.label);
      log('Subtitles', `loaded ${chosen.label} cues=${parsed.length} for ${key}`);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by url, not array identity
  }, [key, showCaptions, videoSec, trackKey]);

  const tick = useCallback((position: number) => {
    if (cues.current.length === 0) {
      setLine(null);
      return;
    }
    setLine(cueAt(cues.current, position));
  }, []);

  return { tracks, label, line, tick };
}