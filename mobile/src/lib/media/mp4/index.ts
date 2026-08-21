// -c copy style container ops, no codecs touched, pure box remux.
// signatures mirror mux.ts so the pipeline can swap without changes.
import type { MediaIO } from '../io';
import type { Mp4Info, Mp4Track } from './reader';
import { parseMp4 } from './reader';
import { interleave, planOutput, writeMuxed } from './writer';
import type { MuxSource } from './writer';
import { assembleSources, readFragments, hlsFileToProgressive } from './fragments';
import { demuxTsToM4a } from '../ts/demux';
import { isWebm } from '../webm/demux';
import { webmToMp4 } from '../webm/toMp4';
import { error as logError, log } from '../../log';

async function parse(io: MediaIO, path: string): Promise<Mp4Info> {
  return parseMp4(io, path, await io.size(path));
}

async function isWebmFile(io: MediaIO, path: string): Promise<boolean> {
  try {
    return await isWebm(io, path);
  } catch {
    return false;
  }
}

function stagedPath(path: string): string {
  return `${path}.prog.mp4`;
}

// fragmented inputs carry an empty moov, so staging them as progressive first
// lets the plain parse + mux paths see real track tables (e.g. youtube 4k).
// the returned path is where stco offsets are valid (staged file when staged).
interface ParsedInput {
  info: Mp4Info;
  path: string;
}

async function parseAny(io: MediaIO, path: string): Promise<ParsedInput | null> {
  let info: Mp4Info;
  try {
    info = await parse(io, path);
  } catch (err) {
    logError('core', `parse failed ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  // init-only moovs (youtube fmp4) carry empty stbl tables, so a parsed
  // track can still have zero chunks — those must stage too
  if (
    info.tracks.length > 0 &&
    info.tracks.some((t) => t.stco.values.length > 0)
  ) {
    return { info, path };
  }
  log('core', `${path}: no chunked tracks, staging as progressive`);
  const staged = stagedPath(path);
  try {
    if (!(await hlsFileToProgressive(io, path, staged))) {
      logError('core', `fragmented reassembly refused ${path}`);
      return null;
    }
    return { info: await parse(io, staged), path: staged };
  } catch (err) {
    logError('core', `fragmented reassembly failed ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function writeOp(
  io: MediaIO,
  outPath: string,
  sources: MuxSource[],
  tracks: Mp4Track[]
): Promise<boolean> {
  if (tracks.length === 0) return false;
  const plan = planOutput(sources[0].info, tracks, interleave(tracks));
  if (plan.chunks.length === 0) {
    logError('core', `empty mux plan ${outPath} (no chunks)`);
    return false;
  }
  const expected =
    plan.mdatPayload + plan.chunks.reduce((acc, ch) => acc + ch.size, 0);
  try {
    // tail writes can silently vanish on some io backends (device repro:
    // moov-only output) — verify the real on-disk size, retry once
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await io.create(outPath);
      await writeMuxed(io, outPath, plan, sources, tracks);
      const actual = await io.size(outPath);
      if (actual === expected) return true;
      logError(
        'core',
        `writeOp short ${outPath}: ${actual} != ${expected} (attempt ${attempt + 1})`
      );
    }
    return false;
  } catch (err) {
    logError('core', `writeOp failed ${outPath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function muxVideoAudio(
  io: MediaIO,
  videoPath: string,
  audioPath: string,
  outPath: string
): Promise<boolean> {
  try {
    const [vWebm, aWebm] = await Promise.all([
      isWebmFile(io, videoPath),
      isWebmFile(io, audioPath),
    ]);
    if (vWebm || aWebm) {
      if (!vWebm || !aWebm) {
        logError('core', `mux mixed containers: video=${vWebm} audio=${aWebm}`);
        return false;
      }
      return webmToMp4(
        io,
        [
          { path: videoPath, kind: 'video' },
          { path: audioPath, kind: 'audio' },
        ],
        outPath
      );
    }
    const [video, audio] = await Promise.all([parseAny(io, videoPath), parseAny(io, audioPath)]);
    if (!video || !audio) {
      logError('core', `mux inputs unusable: video=${Boolean(video)} audio=${Boolean(audio)}`);
      return false;
    }
    const vTrack = video.info.tracks.find((t) => t.kind === 'video');
    const aTrack = audio.info.tracks.find((t) => t.kind === 'audio');
    if (!vTrack || !aTrack) {
      logError('core', `mux track kinds: video=${Boolean(vTrack)} audio=${Boolean(aTrack)}`);
      return false;
    }
    return await writeOp(io, outPath, [{ path: video.path, info: video.info }, { path: audio.path, info: audio.info }], [vTrack, aTrack]);
  } catch (err) {
    logError('core', `mux failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    // awaited inside the try above so staged inputs outlive writeOp reads
    await dropStaged(io, videoPath, audioPath);
  }
}

export async function demuxToM4a(
  io: MediaIO,
  srcPath: string,
  outPath: string
): Promise<boolean> {
  try {
    if (await isWebmFile(io, srcPath)) {
      return webmToMp4(io, [{ path: srcPath, kind: 'audio' }], outPath);
    }
    const parsed = await parseAny(io, srcPath);
    if (!parsed) return false;
    const audio = parsed.info.tracks.find((t) => t.kind === 'audio');
    if (!audio) return false;
    const sources = [audio].map(() => ({ path: parsed.path, info: parsed.info }));
    return await writeOp(io, outPath, sources, [audio]);
  } catch {
    return false;
  } finally {
    await dropStaged(io, srcPath);
  }
}

export async function remuxToMp4(
  io: MediaIO,
  srcPath: string,
  outPath: string
): Promise<boolean> {
  try {
    if (await isWebmFile(io, srcPath)) {
      return webmToMp4(
        io,
        [
          { path: srcPath, kind: 'video' },
          { path: srcPath, kind: 'audio' },
        ],
        outPath
      );
    }
    const parsed = await parseAny(io, srcPath);
    if (!parsed) return false;
    const tracks = parsed.info.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio');
    if (tracks.length === 0) return false;
    const sources = tracks.map(() => ({ path: parsed.path, info: parsed.info }));
    return await writeOp(io, outPath, sources, tracks);
  } catch {
    return false;
  } finally {
    await dropStaged(io, srcPath);
  }
}

async function dropStaged(io: MediaIO, ...paths: string[]): Promise<void> {
  for (const input of paths) {
    try {
      await io.delete(stagedPath(input));
    } catch {
      // best effort
    }
  }
}

// hls concat file -> clean moov-first container, no re-encode.
// fmp4 concats (init + moof/mdat) and ts aac demux are handled natively;
// moov-first mp4 concats go through the plain remux.
export async function hlsConcatToMp4(
  io: MediaIO,
  srcPath: string,
  outPath: string
): Promise<boolean> {
  try {
    const size = await io.size(srcPath);
    if (size < 8) return false;
    const head = await io.read(srcPath, 0, Math.min(size, 16));
    if (head[0] === 0x47) return demuxTsToM4a(io, srcPath, outPath);
    if (await hlsFileToProgressive(io, srcPath, outPath)) return true;
    return remuxToMp4(io, srcPath, outPath);
  } catch {
    return false;
  }
}

// two separate hls concats (video playlist + audio playlist) -> one mp4.
// both must be fragmented mp4; anything else refuses.
export async function hlsMergeToMp4(
  io: MediaIO,
  videoPath: string,
  audioPath: string,
  outPath: string
): Promise<boolean> {
  try {
    const [videoInfo, audioInfo] = await Promise.all([
      readFragments(io, videoPath, await io.size(videoPath)),
      readFragments(io, audioPath, await io.size(audioPath)),
    ]);
    if (!videoInfo || !audioInfo) return false;
    const hasVideo = videoInfo.tracks.some((t) => t.kind === 'video');
    const hasAudio = audioInfo.tracks.some((t) => t.kind === 'audio');
    if (!hasVideo || !hasAudio) return false;
    await assembleSources(
      io,
      outPath,
      [{ path: videoPath, info: videoInfo }, { path: audioPath, info: audioInfo }],
      (t) => t.kind === 'video' || t.kind === 'audio'
    );
    return true;
  } catch {
    return false;
  }
}