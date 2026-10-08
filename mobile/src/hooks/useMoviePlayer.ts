import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { resolve } from '../extractors';
import { VIDROCK_HEADERS } from '../extractors/movies/vidrock';
import { fetchVidzeeFormats } from '../extractors/movies/vidzee';
import { resolveLunaWatchPage } from '../extractors/movies/browserProbe';
import type { MovieRef } from '../extractors/movies/parse';
import type { Format, VideoInfo } from '@phantom/extractors';
import type { MovieItem } from '../extractors/movies/browse';
import { log, error as logError } from '../lib/log';

export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'error';

type TitleRef = { kind: MovieItem['kind']; id: string; season: string; episode: string };

async function freshInfo(
  kind: MovieItem['kind'],
  id: string,
  season: string,
  episode: string
): Promise<VideoInfo | null> {
  const path =
    kind === 'tv' ? `tv/${id}/${season}/${episode}` : `${kind}/${id}`;
  const resolved = await resolve(`https://watchluna.gd/${path}`, undefined, { fresh: true });
  return resolved && !resolved.isPartial && resolved.formats.length > 0 ? resolved : null;
}

export function useMoviePlayer() {
  const [phase, setPhase] = useState<PlayerPhase>('idle');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const rateRef = useRef(1);
  const target = useRef<TitleRef | null>(null);
  const retried = useRef(false);
  const sameRetried = useRef(false);
  const queue = useRef<Format[]>([]);
  const deadUrls = useRef<string[]>([]);

  const player = useVideoPlayer(null, (setup) => {
    setup.timeUpdateEventInterval = 0.5;
  });

  const statusEvent = useEvent(player, 'statusChange', null);
  const playingEvent = useEvent(player, 'playingChange', null);
  const timeEvent = useEvent(player, 'timeUpdate', null);

  const playSource = useCallback(
    async (
      format: Format,
      title: string,
      artwork: string | undefined,
      headers: Record<string, string>,
      at?: number
    ) => {
      const goal = target.current;
      await player.replaceAsync({
        uri: format.url,
        headers,
        contentType: format.isHls ? 'hls' : 'auto',
        metadata: { title, artist: 'Phantom', artwork },
      });
      // close()/open() during the await must not resurrect playback
      if (target.current !== goal) {
        player.pause();
        return;
      }
      if (typeof at === 'number' && at > 1) player.currentTime = at;
      player.play();
      player.playbackRate = rateRef.current;
    },
    [player]
  );

  const setRate = useCallback(
    (next: number) => {
      const clamped = Math.min(2, Math.max(0.25, next));
      rateRef.current = clamped;
      setRateState(clamped);
      player.playbackRate = clamped;
      log('Player', `rate ${clamped}x at ${Math.round(player.currentTime)}s`);
    },
    [player]
  );

  const open = useCallback(
    async (kind: MovieItem['kind'], id: string, season = '1', episode = '1') => {
      const goal = { kind, id, season, episode };
      target.current = goal;
      retried.current = false;
      sameRetried.current = false;
      queue.current = [];
      deadUrls.current = [];
      setPhase('loading');
      setFault(null);
      setInfo(null);
      setCurrentId(null);
      rateRef.current = 1;
      setRateState(1);
      const started = Date.now();
      const slug = kind === 'tv' ? `${kind}/${id}/${season}/${episode}` : `${kind}/${id}`;
      log('Player', `open ${slug}`);
      try {
        const full = await freshInfo(kind, id, season, episode);
        if (target.current !== goal) return;
        if (!full) throw new Error('no playable sources');
        const best = full.formats[0];
        queue.current = full.formats.slice(1);
        setInfo(full);
        setCurrentId(best.formatId);
        await playSource(best, full.title, full.thumbnail ?? undefined, full.downloadHeaders ?? VIDROCK_HEADERS);
        if (target.current !== goal) return;
        setPhase('ready');
        log('Player', `playing ${kind}/${id} ${best.formatId} ms=${Date.now() - started}`);
      } catch (err) {
        if (target.current !== goal) return;
        const message = err instanceof Error ? err.message : String(err);
        setFault(message);
        setPhase('error');
        logError('Player', `open ${kind}/${id} failed: ${message}`);
      }
    },
    [playSource]
  );

  const switchQuality = useCallback(
    async (format: Format) => {
      if (!info) return;
      const at = player.currentTime;
      setCurrentId(format.formatId);
      sameRetried.current = false;
      queue.current = info.formats.filter((entry) => entry.formatId !== format.formatId);
      await playSource(format, info.title, info.thumbnail ?? undefined, info.downloadHeaders ?? VIDROCK_HEADERS, at);
      log('Player', `quality ${format.formatId} resumed at ${Math.round(at)}s`);
    },
    [info, playSource, player]
  );

  useEffect(() => {
    if (statusEvent?.status !== 'error' || !target.current) return;
    const at = player.currentTime;
    const goal = target.current;
    const detail = statusEvent.error?.message ?? 'source died';
    const deadLink = /response code:\s*4\d\d|http\s*4\d\d|playlist http 4\d\d|segment http 4\d\d/i.test(detail);
    const current = info?.formats.find((format) => format.formatId === currentId) ?? null;
    if (current && !deadUrls.current.includes(current.url)) {
      deadUrls.current.push(current.url);
    }
    if (!deadLink && current && !sameRetried.current) {
      sameRetried.current = true;
      log('Player', `${goal.kind}/${goal.id} transient (${detail}) at ${Math.round(at)}s, replaying same source`);
      void playSource(current, info?.title ?? goal.id, info?.thumbnail ?? undefined, info?.downloadHeaders ?? VIDROCK_HEADERS, at).catch(
        (err: unknown) => {
          logError(
            'Player',
            `replay ${current.formatId} failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      );
      return;
    }
    const trying = queue.current[0];
    if (trying) {
      queue.current = queue.current.slice(1);
      sameRetried.current = false;
      log('Player', `${goal.kind}/${goal.id} ${detail} at ${Math.round(at)}s, trying ${trying.formatId}`);
      setCurrentId(trying.formatId);
      void playSource(trying, info?.title ?? goal.id, info?.thumbnail ?? undefined, info?.downloadHeaders ?? VIDROCK_HEADERS, at).catch(
        (err: unknown) => {
          logError(
            'Player',
            `fallback ${trying.formatId} failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      );
      return;
    }
    if (retried.current) {
      setFault(detail);
      setPhase('error');
      logError('Player', `${goal.kind}/${goal.id} all sources exhausted: ${detail}`);
      return;
    }
    retried.current = true;
    log('Player', `${goal.kind}/${goal.id} ${detail} at ${Math.round(at)}s, re-resolving`);
    void (async () => {
      try {
        const full = await freshInfo(goal.kind, goal.id, goal.season, goal.episode);
        if (target.current !== goal) return;
        const fresh = (full?.formats ?? []).filter(
          (format) => !deadUrls.current.includes(format.url)
        );
        if (full && fresh.length > 0) {
          const [best, ...rest] = fresh;
          queue.current = rest;
          sameRetried.current = false;
          setInfo(full);
          setCurrentId(best.formatId);
          await playSource(best, full.title, full.thumbnail ?? undefined, full.downloadHeaders ?? VIDROCK_HEADERS, at);
          log('Player', `resumed ${best.formatId} at ${Math.round(at)}s`);
          return;
        }
        if (!info) throw new Error('no sources on retry');
        log('Player', `${goal.kind}/${goal.id} re-resolve dry, trying browser extraction`);
        const ref: MovieRef =
          goal.kind === 'tv'
            ? { kind: 'tv', tmdbId: goal.id, season: goal.season, episode: goal.episode }
            : { kind: 'movie', tmdbId: goal.id };
        const zee = await fetchVidzeeFormats(ref).catch(() => null);
        if (target.current !== goal) return;
        const zeeFormats = (zee?.formats ?? []).filter(
          (format) => !deadUrls.current.includes(format.url)
        );
        if (zeeFormats.length === 0) {
          if (goal.season !== '1' || goal.episode !== '1') {
            throw new Error('no sources on retry');
          }
          log('Player', `${goal.kind}/${goal.id} trying luna watch page`);
          const luna = await resolveLunaWatchPage(goal.kind, goal.id, info.title).catch(
            () => null
          );
          if (target.current !== goal) return;
          const lunaFormats = (luna?.formats ?? []).filter(
            (format) => !deadUrls.current.includes(format.url)
          );
          if (lunaFormats.length === 0) throw new Error('no sources on retry');
          const [lbest, ...lrest] = lunaFormats;
          queue.current = lrest;
          sameRetried.current = false;
          const lunaHeaders = luna?.headers ?? VIDROCK_HEADERS;
          setInfo({ ...info, formats: lunaFormats, downloadHeaders: lunaHeaders });
          setCurrentId(lbest.formatId);
          await playSource(lbest, info.title, info.thumbnail ?? undefined, lunaHeaders, at);
          log('Player', `resumed ${lbest.formatId} at ${Math.round(at)}s`);
          return;
        }
        const [zbest, ...zrest] = zeeFormats;
        queue.current = zrest;
        sameRetried.current = false;
        const zeeHeaders = zee?.headers ?? VIDROCK_HEADERS;
        setInfo({ ...info, formats: zeeFormats, downloadHeaders: zeeHeaders });
        setCurrentId(zbest.formatId);
        await playSource(zbest, info.title, info.thumbnail ?? undefined, zeeHeaders, at);
        log('Player', `resumed ${zbest.formatId} at ${Math.round(at)}s`);
      } catch (err) {
        if (target.current !== goal) return;
        const message = err instanceof Error ? err.message : String(err);
        setFault(message);
        setPhase('error');
        logError('Player', `retry failed: ${message}`);
      }
    })();
  }, [statusEvent, playSource, player, info, currentId]);

  const close = useCallback(() => {
    player.pause();
    target.current = null;
    queue.current = [];
    setPhase('idle');
    setInfo(null);
    setFault(null);
  }, [player]);

  return {
    player,
    phase,
    info,
    currentId,
    fault,
    rate,
    setRate,
    isPlaying: playingEvent?.isPlaying ?? false,
    position: timeEvent?.currentTime ?? 0,
    open,
    close,
    switchQuality,
  };
}
