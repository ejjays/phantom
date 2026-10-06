import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { resolve } from '../extractors';
import { VIDROCK_HEADERS } from '../extractors/movies/vidrock';
import type { Format, VideoInfo } from '@phantom/extractors';
import type { MovieItem } from '../extractors/movies/browse';
import { log, error as logError } from '../lib/log';

export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'error';

type TitleRef = { kind: MovieItem['kind']; id: string };

async function freshInfo(kind: MovieItem['kind'], id: string): Promise<VideoInfo | null> {
  const resolved = await resolve(`https://watchluna.gd/${kind}/${id}`, undefined, { fresh: true });
  return resolved && !resolved.isPartial && resolved.formats.length > 0 ? resolved : null;
}

export function useMoviePlayer() {
  const [phase, setPhase] = useState<PlayerPhase>('idle');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const target = useRef<TitleRef | null>(null);
  const retried = useRef(false);
  const sameRetried = useRef(false);
  const queue = useRef<Format[]>([]);

  const player = useVideoPlayer(null, (setup) => {
    setup.timeUpdateEventInterval = 0.5;
  });

  const statusEvent = useEvent(player, 'statusChange', null);
  const playingEvent = useEvent(player, 'playingChange', null);
  const timeEvent = useEvent(player, 'timeUpdate', null);

  const playSource = useCallback(
    async (format: Format, title: string, artwork: string | undefined, at?: number) => {
      const goal = target.current;
      await player.replaceAsync({
        uri: format.url,
        headers: VIDROCK_HEADERS,
        metadata: { title, artist: 'Phantom', artwork },
      });
      // close()/open() during the await must not resurrect playback
      if (target.current !== goal) {
        player.pause();
        return;
      }
      if (typeof at === 'number' && at > 1) player.currentTime = at;
      player.play();
    },
    [player]
  );

  const open = useCallback(
    async (kind: MovieItem['kind'], id: string) => {
      const goal = { kind, id };
      target.current = goal;
      retried.current = false;
      sameRetried.current = false;
      queue.current = [];
      setPhase('loading');
      setFault(null);
      setInfo(null);
      setCurrentId(null);
      const started = Date.now();
      log('Player', `open ${kind}/${id}`);
      try {
        const full = await freshInfo(kind, id);
        if (target.current !== goal) return;
        if (!full) throw new Error('no playable sources');
        const best = full.formats[0];
        queue.current = full.formats.slice(1);
        setInfo(full);
        setCurrentId(best.formatId);
        await playSource(best, full.title, full.thumbnail ?? undefined);
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
      await playSource(format, info.title, info.thumbnail ?? undefined, at);
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
    if (!deadLink && current && !sameRetried.current) {
      sameRetried.current = true;
      log('Player', `${goal.kind}/${goal.id} transient (${detail}) at ${Math.round(at)}s, replaying same source`);
      void playSource(current, info?.title ?? goal.id, info?.thumbnail ?? undefined, at).catch(
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
      void playSource(trying, info?.title ?? goal.id, info?.thumbnail ?? undefined, at).catch(
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
        const full = await freshInfo(goal.kind, goal.id);
        if (target.current !== goal) return;
        const candidates = full?.formats ?? [];
        if (!full || candidates.length === 0) throw new Error('no sources on retry');
        const [best, ...rest] = candidates;
        queue.current = rest;
        sameRetried.current = false;
        setInfo(full);
        setCurrentId(best.formatId);
        await playSource(best, full.title, full.thumbnail ?? undefined, at);
        log('Player', `resumed ${best.formatId} at ${Math.round(at)}s`);
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
    isPlaying: playingEvent?.isPlaying ?? false,
    position: timeEvent?.currentTime ?? 0,
    open,
    close,
    switchQuality,
  };
}
