import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';
import { resolve } from '../extractors';
import { VIDROCK_HEADERS } from '../extractors/movies/vidrock';
import { fetchVidzeeFormats } from '../extractors/movies/vidzee';
import { fetchParadiseFormats } from '../extractors/movies/animeparadise';
import { resolveLunaWatchPage } from '../extractors/movies/browserProbe';
import type { MovieRef } from '../extractors/movies/parse';
import type { Format, VideoInfo } from '@phantom/extractors';
import type { MovieItem } from '../extractors/movies/browse';
import { log, error as logError } from '../lib/log';

export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'error';

function aliveFormats(formats: Format[], dead: string[]): Format[] {
  return formats.filter((format) => !dead.includes(format.url));
}

function noteDeadUrl(dead: string[], info: VideoInfo | null, currentId: string | null): void {
  const failed = info?.formats.find((format) => format.formatId === currentId);
  if (failed && !dead.includes(failed.url)) dead.push(failed.url);
}

type RescueResult = { formats: Format[]; headers: Record<string, string> };

async function rescueFormats(
  goal: TitleRef,
  title: string,
  dead: string[]
): Promise<RescueResult | null> {
  const ref: MovieRef =
    goal.kind === 'tv'
      ? { kind: 'tv', tmdbId: goal.id, season: goal.season, episode: goal.episode }
      : { kind: 'movie', tmdbId: goal.id };
  const [zeeRes, paraRes] = await Promise.all([
    fetchVidzeeFormats(ref).catch(() => null),
    fetchParadiseFormats(ref, title).catch(() => null),
  ]);
  for (const res of [zeeRes, paraRes]) {
    const alive = aliveFormats(res?.formats ?? [], dead);
    if (alive.length > 0) {
      return { formats: alive, headers: res?.headers ?? VIDROCK_HEADERS };
    }
  }
  if (goal.season !== '1' || goal.episode !== '1') return null;
  const luna = await resolveLunaWatchPage(goal.kind, goal.id, title).catch(() => null);
  const alive = aliveFormats(luna?.formats ?? [], dead);
  if (alive.length === 0) return null;
  return { formats: alive, headers: luna?.headers ?? VIDROCK_HEADERS };
}

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
    const stillborn = /response code:\s*503/i.test(detail) && at < 1;
    const current = info?.formats.find((format) => format.formatId === currentId) ?? null;
    noteDeadUrl(deadUrls.current, info, currentId);
    if (!deadLink && !stillborn && current && !sameRetried.current) {
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
        const picked = await rescueFormats(goal, info.title, deadUrls.current);
        if (target.current !== goal) return;
        if (!picked) throw new Error('no sources on retry');
        const [best, ...rest] = picked.formats;
        queue.current = rest;
        sameRetried.current = false;
        setInfo({ ...info, formats: picked.formats, downloadHeaders: picked.headers });
        setCurrentId(best.formatId);
        await playSource(best, info.title, info.thumbnail ?? undefined, picked.headers, at);
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
    rate,
    setRate,
    isPlaying: playingEvent?.isPlaying ?? false,
    position: timeEvent?.currentTime ?? 0,
    open,
    close,
    switchQuality,
  };
}
