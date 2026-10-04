import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { resolve } from '../extractors';
import { VIDROCK_HEADERS } from '../extractors/watchluna/vidrock';
import type { Format, VideoInfo } from '@phantom/extractors';
import type { LunaItem } from '../extractors/watchluna/browse';
import { log, error as logError } from '../lib/log';

export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'error';

type TitleRef = { kind: LunaItem['kind']; id: string };

async function freshInfo(kind: LunaItem['kind'], id: string): Promise<VideoInfo | null> {
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

  const player = useVideoPlayer(null, (setup) => {
    setup.timeUpdateEventInterval = 0.5;
  });

  const statusEvent = useEvent(player, 'statusChange', null);
  const playingEvent = useEvent(player, 'playingChange', null);
  const timeEvent = useEvent(player, 'timeUpdate', null);

  const playSource = useCallback(
    async (format: Format, title: string, artwork: string | undefined, at?: number) => {
      await player.replaceAsync({
        uri: format.url,
        headers: VIDROCK_HEADERS,
        metadata: { title, artist: 'Phantom', artwork },
      });
      if (typeof at === 'number' && at > 1) player.currentTime = at;
      player.play();
    },
    [player]
  );

  const open = useCallback(
    async (kind: LunaItem['kind'], id: string) => {
      target.current = { kind, id };
      retried.current = false;
      setPhase('loading');
      setFault(null);
      setInfo(null);
      setCurrentId(null);
      const started = Date.now();
      log('Player', `open ${kind}/${id}`);
      try {
        const full = await freshInfo(kind, id);
        if (!full) throw new Error('no playable sources');
        const best = full.formats[0];
        setInfo(full);
        setCurrentId(best.formatId);
        await playSource(best, full.title, full.thumbnail ?? undefined);
        setPhase('ready');
        log('Player', `playing ${kind}/${id} ${best.formatId} ms=${Date.now() - started}`);
      } catch (err) {
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
      await playSource(format, info.title, info.thumbnail ?? undefined, at);
      log('Player', `quality ${format.formatId} resumed at ${Math.round(at)}s`);
    },
    [info, playSource, player]
  );

  useEffect(() => {
    if (statusEvent?.status !== 'error' || !target.current || retried.current) return;
    retried.current = true;
    const at = player.currentTime;
    const goal = target.current;
    const detail = statusEvent.error?.message ?? 'source died';
    log('Player', `${goal.kind}/${goal.id} ${detail} at ${Math.round(at)}s, re-resolving`);
    void (async () => {
      try {
        const full = await freshInfo(goal.kind, goal.id);
        const best = full?.formats[0];
        if (!full || !best) throw new Error('no sources on retry');
        setInfo(full);
        setCurrentId(best.formatId);
        await playSource(best, full.title, full.thumbnail ?? undefined, at);
        log('Player', `resumed ${best.formatId} at ${Math.round(at)}s`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFault(message);
        setPhase('error');
        logError('Player', `retry failed: ${message}`);
      }
    })();
  }, [statusEvent, playSource, player]);

  const close = useCallback(() => {
    player.pause();
    target.current = null;
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
