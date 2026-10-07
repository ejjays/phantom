import { useCallback, useEffect, useRef, useState } from 'react';
import { File, FileMode, Paths } from 'expo-file-system';
import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import type { Format } from '@phantom/extractors';
import { error as logError, log } from '../lib/log';
import {
  fetchBytesCapped,
  fetchThumbSegments,
  segmentIndexAt,
} from '../lib/seekThumbs';

export type SeekMedia = {
  formats: Format[];
  currentId: string | null;
  headers: Record<string, string>;
} | null;

const BUCKET_SEC = 5;
const FETCH_TIMEOUT_MS = 12000;
const REMOTE_TIMEOUT_MS = 20000;
const HLS_TIMEOUT_MS = 15000;
const DISPLAY_SETTLE_MS = 220;
const MAX_CACHED = 24;
const THUMB_WIDTH = 320;

type ThumbValue = string | VideoThumbnail;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function groupOf(formatId: string): string {
  return formatId.split('-').slice(0, 2).join('-');
}

export function useSeekPreview(
  player: VideoPlayer | null,
  cacheKey: string,
  media: SeekMedia
) {
  const [thumb, setThumb] = useState<ThumbValue | null>(null);
  const cache = useRef(new Map<number, ThumbValue>());
  const gen = useRef(0);
  const dead = useRef(false);
  const busy = useRef(false);
  const pending = useRef<{ bucket: number; at: number } | null>(null);
  const displayed = useRef(-1);
  const displayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbFiles = useRef<string[]>([]);
  const slug = useRef('title');

  useEffect(() => {
    for (const uri of thumbFiles.current) {
      try {
        new File(uri).delete();
      } catch {
        /* cache file optional */
      }
    }
    thumbFiles.current = [];
    slug.current = cacheKey.replace(/[^a-z0-9]+/giu, '_');
    cache.current.clear();
    dead.current = false;
    busy.current = false;
    pending.current = null;
    gen.current += 1;
    displayed.current = -1;
    if (displayTimer.current) clearTimeout(displayTimer.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop stale thumb when the asset changes
    setThumb(null);
  }, [cacheKey]);

  useEffect(
    () => () => {
      if (displayTimer.current) clearTimeout(displayTimer.current);
    },
    []
  );

  const show = useCallback((bucket: number, value: ThumbValue) => {
    if (bucket === displayed.current) {
      setThumb(value);
      return;
    }
    if (displayTimer.current) clearTimeout(displayTimer.current);
    displayTimer.current = setTimeout(() => {
      displayed.current = bucket;
      setThumb(value);
    }, DISPLAY_SETTLE_MS);
  }, []);

  const store = useCallback((bucket: number, value: ThumbValue, at: number) => {
    if (cache.current.size >= MAX_CACHED) {
      const oldest = cache.current.keys().next();
      if (!oldest.done) {
        const dropped = cache.current.get(oldest.value);
        cache.current.delete(oldest.value);
        if (typeof dropped === 'string') {
          try {
            new File(dropped).delete();
          } catch {
            /* cache file optional */
          }
        }
      }
    }
    cache.current.set(bucket, value);
    log('Player', `seek thumb ok at=${at}s`);
  }, []);

  const fail = useCallback((at: number, message: string, fatal: boolean) => {
    if (fatal) dead.current = true;
    logError(
      'Player',
      fatal
        ? `seek thumb failed at=${at}s, previews off for this title: ${message}`
        : `seek thumb slow at=${at}s, keeping last preview: ${message}`
    );
  }, []);

  const grabMp4 = useCallback(
    async (
      at: number,
      url: string,
      headers: Record<string, string>,
      bucket: number
    ): Promise<ThumbValue | null> => {
      if (!player) return null;
      try {
        const thumbs = await withTimeout(
          player.generateThumbnailsAsync(at, { maxWidth: THUMB_WIDTH }),
          FETCH_TIMEOUT_MS
        );
        if (thumbs[0]) return thumbs[0];
      } catch {
        /* retriever can't read this file; ffmpeg range-reads instead */
      }
      try {
        const outFile = new File(Paths.cache, `seekthumb-${slug.current}-${bucket}.jpg`);
        const { remoteExtractFrame } = await import('../lib/download/mux');
        const ok = await withTimeout(
          remoteExtractFrame(url, headers, at, outFile),
          REMOTE_TIMEOUT_MS
        ).catch(() => false);
        if (!ok) return null;
        thumbFiles.current.push(outFile.uri);
        return outFile.uri;
      } catch {
        return null;
      }
    },
    [player]
  );

  const grabHls = useCallback(
    async (
      formats: Format[],
      current: Format,
      headers: Record<string, string>,
      bucket: number,
      at: number,
      tag: string
    ): Promise<string | null> => {
      const group = groupOf(current.formatId);
      const grouped = formats.filter(
        (format) => format.isHls && groupOf(format.formatId) === group
      );
      const pool = (
        grouped.length > 0 ? grouped : formats.filter((format) => format.isHls)
      ).sort((lhs, rhs) => (lhs.height ?? 0) - (rhs.height ?? 0));
      const playlistUrl = pool[0]?.url;
      if (!playlistUrl) return null;
      const started = Date.now();
      const segments = await fetchThumbSegments(playlistUrl, headers);
      if (!segments) return null;
      const index = segmentIndexAt(segments, at);
      if (index < 0) return null;
      const seg = segments[index];
      const bytes = await fetchBytesCapped(seg.uri, headers);
      const fetchedMs = Date.now() - started;
      if (!bytes) {
        log('Player', `seek thumb segment empty at=${at}s ms=${fetchedMs}`);
        return null;
      }
      log(
        'Player',
        `seek thumb segment at=${at}s bytes=${bytes.length} ms=${fetchedMs}`
      );
      const segFile = new File(Paths.cache, 'seekseg.ts');
      const outFile = new File(Paths.cache, `seekthumb-${tag}-${bucket}.jpg`);
      const handle = segFile.open(FileMode.WriteOnly);
      try {
        handle.writeBytes(bytes);
      } finally {
        handle.close();
      }
      const { extractFrame } = await import('../lib/download/mux');
      const ok = await extractFrame(segFile, outFile).catch(() => false);
      if (!ok) return null;
      thumbFiles.current.push(outFile.uri);
      return outFile.uri;
    },
    []
  );

  const pump = useCallback(() => {
    if (!player || dead.current || busy.current) return;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const id = ++gen.current;
    const { bucket, at } = next;
    busy.current = true;
    log('Player', `seek thumb fetching at=${at}s`);
    const current =
      media?.formats.find((format) => format.formatId === media.currentId) ??
      null;
    const work: Promise<ThumbValue | null> =
      current?.isHls && media
        ? withTimeout(
            grabHls(
              media.formats,
              current,
              media.headers,
              bucket,
              at,
              slug.current
            ),
            HLS_TIMEOUT_MS
          )
        : current && media
          ? grabMp4(at, current.url, media.headers, bucket)
          : Promise.resolve(null);
    void work.then(
      (result) => {
        busy.current = false;
        if (gen.current !== id) return;
        if (result) {
          store(bucket, result, at);
          show(bucket, result);
        } else {
          fail(at, 'no frame', true);
        }
        pump();
      },
      (err: unknown) => {
        busy.current = false;
        if (gen.current !== id) return;
        const message = err instanceof Error ? err.message : String(err);
        fail(at, message, !message.startsWith('timed out'));
        pump();
      }
    );
  }, [player, media, store, show, fail, grabMp4, grabHls]);

  const request = useCallback(
    (timeSec: number) => {
      if (Number.isNaN(timeSec) || timeSec < 0 || !player || dead.current)
        return;
      const bucket = Math.floor(timeSec / BUCKET_SEC);
      const hit = cache.current.get(bucket);
      if (hit) {
        pending.current = null;
        show(bucket, hit);
        return;
      }
      pending.current = { bucket, at: bucket * BUCKET_SEC };
      pump();
    },
    [player, pump, show]
  );

  const clear = useCallback(() => {
    gen.current += 1;
    pending.current = null;
    displayed.current = -1;
    if (displayTimer.current) clearTimeout(displayTimer.current);
    setThumb(null);
  }, []);

  return { thumb, request, clear };
}
