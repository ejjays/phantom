import { File, Paths } from 'expo-file-system';
import { deleteAsync, moveAsync } from 'expo-file-system/legacy';
import { DESKTOP_UA } from '../userAgents';
import type { Format, VideoInfo } from '../../extractors/types';
import { refererFor, type DownloadState } from '../format';
import { chunkedDownload } from './download';
import {
  muxVideoAudio,
  transcodeToMp3,
  demuxToM4a,
  hlsToMp4,
  parallelHlsToMp4,
  parallelHlsMuxedToMp4,
  tagAudio,
} from './mux';
import { saveToDevice } from './save';
import { log } from '../log';
import { upsertInflight, removeInflight, type InflightItem } from '../inflight';
import { addHistory } from '../downloadHistory';

export type DownloadOutcome = { status: 'saved' | 'denied'; uri?: string };

export type RunDownloadInput = {
  info: VideoInfo;
  format: Format;
  stem: string;
  tag?: { title?: string; artist?: string };
  signal: AbortSignal;
  onState: (state: DownloadState) => void;
  /** reuse stored progress (resume path) instead of starting at 0 */
  seed?: InflightItem;
};

const removeFile = (file: File): Promise<void> =>
  deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);

/**
 * Builds resumable download metadata from media details and optional existing state.
 *
 * @param info - Media metadata used to populate the download state
 * @param format - Media format selected for the download
 * @param stem - Identifier used for the download
 * @param tag - Optional audio metadata
 * @param seed - Existing state whose values take precedence when provided
 * @returns The initialized or updated inflight download metadata
 */
function buildInflight(
  info: VideoInfo,
  format: Format,
  stem: string,
  tag: { title?: string; artist?: string } | undefined,
  seed?: InflightItem
): InflightItem {
  const pick = <T,>(a: T | undefined, fallback: T): T =>
    a !== undefined ? a : fallback;
  return {
    id: stem,
    title: pick(seed?.title, info.title),
    author: pick(seed?.author, info.uploader),
    platform: pick(seed?.platform, info.extractorKey),
    ext: pick(seed?.ext, format.extension || 'mp4'),
    isAudio: pick(seed?.isAudio, format.isAudio && !format.isVideo),
    thumbnail: pick(seed?.thumbnail, info.thumbnail),
    progress: pick(seed?.progress, 0),
    updatedAt: Date.now(),
    info: {
      title: pick(seed?.info.title, info.title),
      uploader: pick(seed?.info.uploader, info.uploader),
      album: pick(seed?.info.album, info.album),
      thumbnail: pick(seed?.info.thumbnail, info.thumbnail),
      duration: pick(seed?.info.duration, info.duration),
      extractorKey: pick(seed?.info.extractorKey, info.extractorKey),
      downloadHeaders: pick(
        seed?.info.downloadHeaders,
        info.downloadHeaders
      ),
    },
    format: pick(seed?.format, format),
    tag: pick(seed?.tag, tag),
  };
}

/**
 * Applies audio metadata and optional thumbnail artwork to a file in place.
 *
 * @param saveTarget - The audio file to tag and replace when tagging succeeds
 * @param info - Media metadata used for the title, artist, album, and optional artwork
 * @param tag - Optional metadata overrides for the title and artist
 */
async function tagAudioInPlace(
  saveTarget: File,
  stem: string,
  info: VideoInfo,
  tag: { title?: string; artist?: string } | undefined,
  track: (file: File) => File
): Promise<void> {
  let cover: File | undefined;
  if (info.thumbnail) {
    try {
      const art = track(new File(Paths.cache, `${stem}.cover.jpg`));
      await File.downloadFileAsync(info.thumbnail, art, { idempotent: true });
      cover = art;
    } catch {
      /* cover optional */
    }
  }
  const saveExt = saveTarget.name.split('.').pop() || 'm4a';
  const tagged = track(new File(Paths.cache, `${stem}.tagged.${saveExt}`));
  const ok = await tagAudio(
    saveTarget,
    tagged,
    {
      title: tag?.title || info.title,
      artist: tag?.artist || info.uploader,
      album: info.album,
    },
    cover
  );
  if (ok) {
    await removeFile(saveTarget);
    await moveAsync({ from: tagged.uri, to: saveTarget.uri });
  }
}

type FetchMediaInput = {
  info: VideoInfo;
  format: Format;
  stem: string;
  signal: AbortSignal;
  onState: (state: DownloadState) => void;
  report: (state: DownloadState) => void;
  track: (file: File) => File;
};

/**
 * Downloads media and converts, extracts, or combines streams according to the requested format.
 *
 * @param info - Media metadata and download settings.
 * @param format - Format and stream configuration to use.
 * @param stem - Base name for temporary and output files.
 * @returns The downloaded media file.
 * @throws An error if downloading, conversion, stream combination, or cancellation fails.
 */
async function fetchMedia({
  info,
  format,
  stem,
  signal,
  onState,
  report,
  track,
}: FetchMediaInput): Promise<File> {
  const ext = format.extension || 'mp4';
  const headers = info.downloadHeaders ?? {
    'User-Agent': DESKTOP_UA,
    Referer: refererFor(info.extractorKey),
  };
  const chunked =
    info.extractorKey === 'youtube' || info.extractorKey === 'spotify';

  const fetchTo = async (
    dlUrl: string,
    dest: File,
    base: number,
    cap: number,
    label: string
  ): Promise<void> => {
    const startedAt = Date.now();
    let written = 0;
    const onProg = (done: number, total: number): void => {
      written = done;
      if (total > 0) {
        report({
          status: 'downloading',
          progress: base + Math.round((done / total) * cap),
        });
      }
    };
    if (chunked) {
      await chunkedDownload(dlUrl, headers, dest, onProg, signal);
    } else {
      await File.downloadFileAsync(dlUrl, dest, {
        idempotent: true,
        headers,
        onProgress: ({ bytesWritten, totalBytes }) =>
          onProg(bytesWritten, totalBytes),
      });
    }
    if (signal.aborted) throw new Error('cancelled');
    const secs = Math.max((Date.now() - startedAt) / 1000, 0.1);
    log(
      'downloadPipeline',
      `[Download] ${label} ${mb(written)}MB in ${secs.toFixed(1)}s (${(written / 1048576 / secs).toFixed(1)} MB/s)`
    );
  };

  if (format.extension === 'mp3') {
    if (format.noTranscode) {
      // already native mp3; download & keep untouched
      const outFile = track(new File(Paths.cache, `${stem}.mp3`));
      await fetchTo(format.url, outFile, 0, 100, 'audio');
      return outFile;
    }
    const srcFile = track(new File(Paths.cache, `${stem}.audtmp`));
    await fetchTo(format.url, srcFile, 0, 85, 'audio');
    onState({ status: 'muxing', progress: 90 });
    const outFile = track(new File(Paths.cache, `${stem}.mp3`));
    const ok = await transcodeToMp3(srcFile, outFile);
    await removeFile(srcFile);
    if (!ok) throw new Error('MP3 conversion failed');
    return outFile;
  }
  if (format.audioDemux) {
    // audio-only from a muxed video: download it, copy the audio track out
    const srcFile = track(new File(Paths.cache, `${stem}.srctmp`));
    await fetchTo(format.url, srcFile, 0, 85, 'audio');
    onState({ status: 'muxing', progress: 90 });
    const outFile = track(new File(Paths.cache, `${stem}.m4a`));
    const ok = await demuxToM4a(srcFile, outFile);
    await removeFile(srcFile);
    if (!ok) throw new Error('Audio extraction failed');
    return outFile;
  }
  if (format.muxAudioUrl) {
    const videoFile = track(new File(Paths.cache, `${stem}.vid.${ext}`));
    const audioFile = track(
      new File(Paths.cache, `${stem}.aud.${format.muxAudioExt || 'm4a'}`)
    );
    await fetchTo(format.url, videoFile, 0, 80, 'video');
    await fetchTo(format.muxAudioUrl, audioFile, 80, 10, 'audio');
    onState({ status: 'muxing', progress: 92 });
    const outFile = track(new File(Paths.cache, `${stem}.${ext}`));
    const mStart = Date.now();
    const ok = await muxVideoAudio(videoFile, audioFile, outFile);
    log(
      'downloadPipeline',
      `[Download] mux ${ok ? 'ok' : 'failed'} in ${((Date.now() - mStart) / 1000).toFixed(1)}s`
    );
    await removeFile(videoFile);
    await removeFile(audioFile);
    if (!ok) throw new Error('Muxing failed');
    return outFile;
  }
  if (format.isHls) {
    const outFile = track(new File(Paths.cache, `${stem}.${ext}`));
    // sum segment durations for progress
    let durationSec = info.duration ?? 0;
    if (!durationSec) {
      try {
        const playlist = await (await fetch(format.url, { headers })).text();
        durationSec = [...playlist.matchAll(/#EXTINF:([\d.]+)/gu)].reduce(
          (sum, hit) => sum + Number(hit[1]),
          0
        );
      } catch {
        /* progress optional */
      }
    }
    onState({ status: 'downloading', progress: 0 });
    const hStart = Date.now();
    const onHls = (pct: number): void =>
      onState({ status: 'downloading', progress: Math.min(98, pct) });
    // separate video+audio hls -> parallel fetch; else ffmpeg
    let ok = false;
    let path = 'ffmpeg';
    if (format.hlsAudioUrl) {
      ok = await parallelHlsToMp4(
        format.url,
        format.hlsAudioUrl,
        outFile,
        headers,
        onHls,
        signal
      );
      if (ok) path = 'parallel';
    } else {
      ok = await parallelHlsMuxedToMp4(
        format.url,
        outFile,
        headers,
        onHls,
        signal
      );
      if (ok) path = 'parallel-muxed';
    }
    if (signal.aborted) throw new Error('cancelled');
    if (!ok) {
      ok = await hlsToMp4(
        format.url,
        outFile,
        durationSec,
        onHls,
        format.hlsAudioUrl,
        format.hlsKeepAlive
      );
    }
    log(
      'downloadPipeline',
      `[Download] hls (${path}) ${ok ? 'ok' : 'failed'} in ${((Date.now() - hStart) / 1000).toFixed(1)}s`
    );
    if (signal.aborted) throw new Error('cancelled');
    if (!ok) throw new Error('HLS download failed');
    // big 4k saves are slow; avoid a frozen-looking 98%
    onState({ status: 'muxing', progress: 99 });
    return outFile;
  }
  const destination = track(new File(Paths.cache, `${stem}.${ext}`));
  await fetchTo(format.url, destination, 0, 100, 'file');
  return destination;
}

/**
 * Downloads, prepares, and saves media while tracking progress and resumable state.
 *
 * @param stem - Identifier and filename stem for the download
 * @param tag - Optional metadata used when tagging audio
 * @param seed - Previously persisted state used to resume an interrupted download
 * @returns A saved result containing the device URI, or a denied result when saving is not permitted
 * @throws Propagates errors encountered during downloading, processing, tagging, or saving
 */
export async function runDownload({
  info,
  format,
  stem,
  tag,
  signal,
  onState,
  seed,
}: RunDownloadInput): Promise<DownloadOutcome> {
  const temps: File[] = [];
  const track = (file: File): File => {
    temps.push(file);
    return file;
  };

  const inflight = buildInflight(info, format, stem, tag, seed);
  await upsertInflight(inflight);

  let lastReported = seed?.progress ?? 0;
  const report = (state: DownloadState): void => {
    onState(state);
    if (state.status === 'downloading') {
      // registry write per chunk is wasteful; persist on ~1% deltas only
      if (Math.abs(state.progress - lastReported) < 1) return;
      lastReported = state.progress;
      void upsertInflight({
        ...inflight,
        progress: state.progress,
        updatedAt: Date.now(),
      });
    }
  };

  let threw: unknown;
  try {
    const saveTarget = await fetchMedia({
      info,
      format,
      stem,
      signal,
      onState,
      report,
      track,
    });

    // tag audio so players show title/artist/art
    if (format.isAudio && !format.isVideo) {
      await tagAudioInPlace(saveTarget, stem, info, tag, track);
    }

    const saved = await saveToDevice(saveTarget, (pct) =>
      onState({ status: 'saving', progress: pct })
    );
    await removeFile(saveTarget);
    if (saved.ok) {
      await addHistory({
        id: stem,
        title: inflight.title,
        author: inflight.author,
        platform: inflight.platform,
        ext: inflight.ext,
        isAudio: inflight.isAudio,
        thumbnail: inflight.thumbnail,
        uri: saved.uri,
        savedAt: Date.now(),
      });
    }
    return saved.ok
      ? { status: 'saved', uri: saved.uri }
      : { status: 'denied' };
  } catch (error) {
    threw = error;
    throw error;
  } finally {
    const cancelled = signal.aborted;
    // cancel/success wipe everything; on failure keep the partial +
    // sidecar + inflight row so a retry resumes from the real byte count
    if (cancelled || !threw) {
      await removeInflight(stem);
      await Promise.all(temps.map(removeFile));
    }
  }
}

/**
 * Resumes an interrupted media download using its stored metadata and progress state.
 *
 * @param item - The stored download state to resume
 * @param onState - Callback invoked with download progress updates
 * @param signal - Signal used to cancel the download
 * @returns The outcome of the resumed download
 */
export function resumeInflight(
  item: InflightItem,
  onState: (state: DownloadState) => void,
  signal: AbortSignal
): Promise<DownloadOutcome> {
  return runDownload({
    info: {
      ...item.info,
      formats: [],
      type: 'video',
      id: item.id,
      webpageUrl: '',
      isJsInfo: false,
      fromBrain: false,
      isPartial: false,
      isIsrcMatch: false,
      isFullData: false,
    },
    format: item.format,
    stem: item.id,
    tag: item.tag,
    signal,
    onState,
    seed: item,
  });
}

/**
 * Discards inflight download state and removes matching cached partial files.
 *
 * @param id - The download identifier used to locate inflight state and cached files
 */
export async function discardInflight(id: string): Promise<void> {
  await removeInflight(id);
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(`${id}.`)) {
        entry.delete();
      }
    }
  } catch {
    /* best-effort sweep of orphaned partials */
  }
}
