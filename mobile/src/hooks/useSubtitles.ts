import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchVidloveSubtitles,
  vidloveHeaders,
} from '../extractors/movies/vidlove';
import { fetchKitsunekkoSubtitles } from '../extractors/movies/kitsunekko';
import {
  fetchOpenSubtitles,
  fetchOpenSubtitlesByHash,
  hashMediaUrl,
} from '../extractors/movies/opensubtitles';
import { fetchTmdbTitle } from '../extractors/movies/tmdb';
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

// providers off by default: vidlove/opensubtitles/kitsunekko timing is
// unreliable (wrong cuts, drift, gaps) next to cloud transcripts, and mixed
// sources confuse which subs are showing. code kept as reference; flip to
// restore the classic chain.
const PROVIDERS_OFF = true;

export function useSubtitles(
  ref: MovieRef | null,
  videoSec: number,
  showCaptions: boolean,
  hashUrl: string | null
) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const cues = useRef<SubtitleCue[]>([]);
  const generatedFor = useRef<string>('');
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
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
    generatedFor.current = '';
    setTracks([]);
    setLabel(null);
    setLine(null);
    // see PROVIDERS_OFF: cloud transcribe generates only for now
    if (PROVIDERS_OFF) {
      log('Subtitles', `provider chain disabled for ${key}`);
      return undefined;
    }
    if (!ref) return undefined;
    let cancelled = false;
    void (async () => {
      for (let round = 0; round < 3; round++) {
        if (tracksRef.current.length > 0) return;
        const found = await fetchVidloveSubtitles(ref).catch(() => []);
        if (cancelled) return;
        if (found.length > 0) {
          if (pickTrack(found, 'en') && tracksRef.current.length === 0) {
            setTracks(found);
          }
          return;
        }
        if (round < 2) {
          await new Promise((done) => setTimeout(done, 6000));
        }
      }
      if (!cancelled) {
        const os = await fetchOpenSubtitles(ref).catch(() => []);
        if (!cancelled && os.length > 0) {
          setTracks(os);
          return;
        }
      }
      if (!cancelled && ref.kind === 'tv' && ref.season === '1') {
        const meta = await fetchTmdbTitle(ref.kind, ref.tmdbId).catch(
          () => null
        );
        if (!cancelled && meta?.title) {
          const jp = await fetchKitsunekkoSubtitles(
            meta.title,
            ref.episode
          ).catch(() => []);
          if (!cancelled && jp.length > 0) {
            setTracks(jp);
            return;
          }
        }
      }
      if (!cancelled) log('Subtitles', `no tracks for ${key}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ref]);

  useEffect(() => {
    if (PROVIDERS_OFF) return undefined;
    if (!ref || !hashUrl || tracks.length > 0) return undefined;
    let cancelled = false;
    void (async () => {
      const hashed = await hashMediaUrl(hashUrl).catch(() => null);
      if (cancelled || !hashed) return;
      const found = await fetchOpenSubtitlesByHash(
        hashed.hash,
        hashed.size
      ).catch(() => []);
      if (!cancelled && found.length > 0) setTracks(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [ref, hashUrl, tracks.length, key]);

  useEffect(() => {
    cues.current = [];
    setLine(null);
    if (!ref || !showCaptions || tracks.length === 0) return undefined;
    if (generatedFor.current === key) return undefined;
    let cancelled = false;
    void (async () => {
      const chosen = pickTrack(tracks, 'en') ?? tracks[0];
      if (!chosen) return;
      const text = await fetchVttText(chosen.url, vidloveHeaders(ref)).catch(
        () => null
      );
      if (cancelled || !text) return;
      if (generatedFor.current === key) return;
      const parsed = fitCuesToDuration(parseVtt(text), videoSec);
      if (parsed.length === 0) {
        log('Subtitles', `empty track ${chosen.label} for ${key}`);
        return;
      }
      cues.current = parsed;
      setLabel(chosen.label);
      log(
        'Subtitles',
        `loaded ${chosen.label} cues=${parsed.length} for ${key}`
      );
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

  const getCues = useCallback((): SubtitleCue[] => [...cues.current], []);

  const setGeneratedCues = useCallback(
    (generated: SubtitleCue[], name: string): void => {
      cues.current = generated;
      generatedFor.current = key;
      setLabel(name);
    },
    [key]
  );

  return { tracks, label, line, tick, getCues, setGeneratedCues };
}
