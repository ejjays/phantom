import { be16, be32, box, concat } from '../boxes';
import type { MediaIO } from '../io';
import { log } from '../../log';
import { children, find, parseMp4, topLevelBoxes } from './reader';
import type { Mp4Info, Mp4Track } from './reader';
import { interleave, planOutput, writeMuxed } from './writer';
import type { MuxSource } from './writer';

// fragmented mp4 (hls init + moof/mdat segments) -> progressive mp4

export interface FragSample {
  size: number;
  duration: number;
  cto: number;
  offset: number;
}

export interface FragTrack {
  id: number;
  kind: 'video' | 'audio';
  timescale: number;
  samples: FragSample[];
  chunkStarts: number[];
  initRaw: Uint8Array;
}

export interface FragmentsInfo {
  ftyp: Uint8Array | null;
  movieTimescale: number;
  udta: Uint8Array | null;
  tracks: FragTrack[];
}

interface Tfhd {
  trackId: number;
  baseDataOffset: number | null;
  defaultBaseIsMoof: boolean;
  defaultDuration: number | null;
  defaultSize: number | null;
}

interface TrexDefaults {
  defaultDuration: number | null;
  defaultSize: number | null;
}

interface Trun {
  trackId: number;
  sizes: number[];
  durations: number[];
  ctos: number[];
  offsets: number[];
}

const TRUN_DATA_OFFSET = 0x1;
const TRUN_FIRST_FLAGS = 0x4;
const TRUN_DURATION = 0x100;
const TRUN_SIZE = 0x200;
const TRUN_FLAGS = 0x400;
const TRUN_CTO = 0x800;

const TFHD_BASE_OFFSET = 0x1;
const TFHD_DEFAULT_DURATION = 0x8;
const TFHD_DEFAULT_SIZE = 0x10;
const TFHD_DURATION_IS_EMPTY = 0x10000;
const TFHD_DEFAULT_BASE_MOOF = 0x20000;

// moov/mvex/trex defaults apply when tfhd omits its own defaults
function parseTrex(moov: Uint8Array): Map<number, TrexDefaults> {
  const moovKids = children(moov, 8, moov.length);
  const mvex = find(moovKids, 'mvex');
  if (!mvex) return new Map();
  const map = new Map<number, TrexDefaults>();
  for (const trex of children(moov, mvex.start + 8, mvex.end)) {
    if (trex.type !== 'trex') continue;
    const raw = moov;
    const trackId = (raw[trex.start + 8] << 24) | (raw[trex.start + 9] << 16) | (raw[trex.start + 10] << 8) | raw[trex.start + 11];
    const dur = (raw[trex.start + 16] << 24) | (raw[trex.start + 17] << 16) | (raw[trex.start + 18] << 8) | raw[trex.start + 19];
    const size = (raw[trex.start + 20] << 24) | (raw[trex.start + 21] << 16) | (raw[trex.start + 22] << 8) | raw[trex.start + 23];
    map.set(trackId, { defaultDuration: dur, defaultSize: size });
  }
  return map;
}

function parseTfhd(bytes: Uint8Array, start: number, end: number): Tfhd {
  const flags = (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
  let pos = start + 4;
  const trackId = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
  pos += 4;
  let baseDataOffset: number | null = null;
  if (flags & TFHD_BASE_OFFSET) {
    baseDataOffset = Number((BigInt(bytes[pos]) << 32n) | BigInt((bytes[pos + 1] << 24) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 8) | bytes[pos + 4]));
    pos += 8;
  }
  if (flags & 0x2) pos += 4;
  let defaultDuration: number | null = null;
  if (flags & TFHD_DEFAULT_DURATION) {
    defaultDuration = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
  }
  let defaultSize: number | null = null;
  if (flags & TFHD_DEFAULT_SIZE) {
    defaultSize = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
  }
  void end;
  void pos;
  return {
    trackId,
    baseDataOffset,
    defaultBaseIsMoof: (flags & TFHD_DEFAULT_BASE_MOOF) !== 0,
    defaultDuration,
    defaultSize,
  };
}

function parseTrun(bytes: Uint8Array, start: number, end: number, tfhd: Tfhd): Trun {
  const version = bytes[start];
  const flags = (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
  let pos = start + 4;
  const count = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
  pos += 4;
  let dataOffset = 0;
  if (flags & TRUN_DATA_OFFSET) {
    dataOffset = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
  }
  if (flags & TRUN_FIRST_FLAGS) pos += 4;

  const sizes: number[] = [];
  const durations: number[] = [];
  const ctos: number[] = [];
  for (let i = 0; i < count; i++) {
    if (flags & TRUN_DURATION) {
      durations.push((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
      pos += 4;
    } else {
      durations.push(tfhd.defaultDuration ?? 0);
    }
    if (flags & TRUN_SIZE) {
      sizes.push((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
      pos += 4;
    } else {
      sizes.push(tfhd.defaultSize ?? 0);
    }
    if (flags & TRUN_FLAGS) pos += 4;
    if (flags & TRUN_CTO) {
      const raw = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      ctos.push(version === 1 ? raw | 0 : raw);
      pos += 4;
    } else {
      ctos.push(0);
    }
  }
  if (pos > end) throw new Error('trun overrun');

  const offsets: number[] = [];
  let cursor = dataOffset;
  for (let i = 0; i < count; i++) {
    offsets.push(cursor);
    cursor += sizes[i];
  }
  return { trackId: tfhd.trackId, sizes, durations, ctos, offsets };
}

interface MdatRegion {
  start: number;
  payloadStart: number;
  end: number;
}

export async function readFragments(
  io: MediaIO,
  path: string,
  fileSize: number
): Promise<FragmentsInfo | null> {
  const top = await topLevelBoxes(io, path, fileSize);
  const ftypBox = top.find((bx) => bx.type === 'ftyp');
  const moovBox = top.find((bx) => bx.type === 'moov');
  if (!moovBox) return null;
  const ftyp = ftypBox ? await io.read(path, ftypBox.offset, ftypBox.size) : null;
  const moov = await io.read(path, moovBox.offset, moovBox.size);

  const moovKids = children(moov, 8, moov.length);
  if (find(moovKids, 'sinf') || moovKids.some((bx) => bx.type === 'encv' || bx.type === 'enca')) {
    return null;
  }
  const trexDefaults = parseTrex(moov);
  const initInfo = await parseMp4(io, path, fileSize);
  if (initInfo.tracks.length === 0) return null;

  const mdats: MdatRegion[] = [];
  for (const box of top) {
    if (box.type === 'mdat') {
      mdats.push({ start: box.offset, payloadStart: box.offset + box.headerSize, end: box.offset + box.size });
    }
  }
  if (mdats.length === 0) return null;
  const mdatLookup = (abs: number): boolean => mdats.some((mdat) => abs >= mdat.payloadStart && abs < mdat.end);

  const tracks: FragTrack[] = initInfo.tracks.map((t) => ({
    id: t.id,
    kind: t.kind,
    timescale: t.timescale,
    samples: [],
    chunkStarts: [],
    initRaw: t.raw,
  }));
  const byId = new Map(tracks.map((t) => [t.id, t]));

  for (const box of top) {
    if (box.type !== 'moof') continue;
    const moof = await io.read(path, box.offset, box.size);
    const moofStart = box.offset;
    const fallbackBase = ((): number => {
      const next = mdats.find((mdat) => mdat.payloadStart >= moofStart + box.size);
      return next ? next.payloadStart : moofStart;
    })();

    const inChunk = new Set<number>();
    for (const traf of children(moof, 8, moof.length)) {
      if (traf.type !== 'traf') continue;
      const trafKids = children(moof, traf.start + 8, traf.end);
      const tfhdBox = find(trafKids, 'tfhd');
      const trunBox = find(trafKids, 'trun');
      if (!tfhdBox || !trunBox) return null;
      const tfhd = parseTfhd(moof, tfhdBox.start + 8, tfhdBox.end);
      const track = byId.get(tfhd.trackId);
      if (!track) return null;
      const trex = trexDefaults.get(tfhd.trackId);
      if (trex) {
        tfhd.defaultDuration ??= trex.defaultDuration;
        tfhd.defaultSize ??= trex.defaultSize;
      }
      const base = tfhd.baseDataOffset ?? (tfhd.defaultBaseIsMoof ? moofStart : fallbackBase);
      const trun = parseTrun(moof, trunBox.start + 8, trunBox.end, tfhd);
      for (let i = 0; i < trun.sizes.length; i++) {
        const abs = base + trun.offsets[i];
        if (!mdatLookup(abs) || !mdatLookup(abs + trun.sizes[i] - 1)) return null;
        track.samples.push({
          size: trun.sizes[i],
          duration: trun.durations[i],
          cto: trun.ctos[i],
          offset: abs,
        });
      }
      inChunk.add(track.id);
    }
    for (const t of tracks) {
      if (inChunk.has(t.id)) t.chunkStarts.push(t.samples.length);
    }
  }

  for (const t of tracks) {
    if (t.samples.length === 0) return null;
  }
  return { ftyp, movieTimescale: initInfo.movieTimescale, udta: initInfo.udta, tracks };
}

// ---- rebuild side ----

function u32be(value: number): Uint8Array {
  return be32(value);
}

function sttsBox(durations: number[]): Uint8Array {
  const runs: { count: number; delta: number }[] = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last.delta === d) last.count += 1;
    else runs.push({ count: 1, delta: d });
  }
  const entries = concat(...runs.flatMap((run) => [u32be(run.count), u32be(run.delta)]));
  return box('stts', concat(u32be(0), u32be(runs.length), entries));
}

function stszBox(sizes: number[]): Uint8Array {
  const fixed = sizes.every((s) => s === sizes[0]) ? sizes[0] : 0;
  const body = fixed === 0 ? concat(...sizes.map(u32be)) : new Uint8Array(0);
  return box('stsz', concat(u32be(0), u32be(fixed), u32be(sizes.length), body));
}

function stscBox(chunkSizes: number[]): Uint8Array {
  const entries = chunkSizes.flatMap((num, i) => [u32be(i + 1), u32be(num), u32be(1)]);
  return box('stsc', concat(u32be(0), u32be(chunkSizes.length), ...entries));
}

function cttsBox(ctos: number[]): Uint8Array | null {
  if (ctos.every((cto) => cto === 0)) return null;
  const runs: { count: number; delta: number }[] = [];
  for (const cto of ctos) {
    const last = runs[runs.length - 1];
    if (last && last.delta === cto) last.count += 1;
    else runs.push({ count: 1, delta: cto });
  }
  const entries = concat(...runs.flatMap((run) => [u32be(run.count), u32be(run.delta)]));
  return box('ctts', concat(u32be(0), u32be(runs.length), entries));
}

function stcoBox(offsets: number[]): Uint8Array {
  const co64 = offsets.some((v) => v > 0xfffffff0);
  const body = co64
    ? concat(...offsets.map((v) => {
        const out = new Uint8Array(8);
        new DataView(out.buffer).setBigUint64(0, BigInt(v));
        return out;
      }))
    : concat(...offsets.map(u32be));
  return box(co64 ? 'co64' : 'stco', concat(u32be(0), u32be(offsets.length), body));
}

function stsdRaw(track: FragTrack): Uint8Array {
  const trakKids = children(track.initRaw, 8, track.initRaw.length);
  const mdia = find(trakKids, 'mdia');
  if (!mdia) throw new Error('no mdia');
  const mdiaKids = children(track.initRaw, mdia.start + 8, mdia.end);
  const minf = find(mdiaKids, 'minf');
  if (!minf) throw new Error('no minf');
  const minfKids = children(track.initRaw, minf.start + 8, minf.end);
  const stbl = find(minfKids, 'stbl');
  if (!stbl) throw new Error('no stbl');
  const stblKids = children(track.initRaw, stbl.start + 8, stbl.end);
  const stsd = find(stblKids, 'stsd');
  if (!stsd) throw new Error('no stsd');
  return track.initRaw.subarray(stsd.start, stsd.end);
}

function setU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function patchMdhdDuration(raw: Uint8Array, duration: number): Uint8Array {
  const mdia = find(children(raw, 8, raw.length), 'mdia');
  const mdhd = mdia ? find(children(raw, mdia.start + 8, mdia.end), 'mdhd') : undefined;
  if (!mdhd) return raw;
  const ver = raw[mdhd.start + 8];
  const durOff = mdhd.start + (ver === 1 ? 32 : 24);
  const out = new Uint8Array(raw);
  out.set([(duration >>> 24) & 0xff, (duration >>> 16) & 0xff, (duration >>> 8) & 0xff, duration & 0xff], durOff);
  return out;
}

// chunkStarts hold the end sample index of each segment chunk
function chunkOffsetsPerSegment(track: FragTrack): number[] {
  return track.chunkStarts.map((end, i) => track.samples[i === 0 ? 0 : track.chunkStarts[i - 1]].offset);
}

function chunkSampleCounts(track: FragTrack): number[] {
  const counts: number[] = [];
  for (let i = 0; i < track.chunkStarts.length; i++) {
    const start = i === 0 ? 0 : track.chunkStarts[i - 1];
    counts.push(track.chunkStarts[i] - start);
  }
  return counts;
}

function patchTkhdId(raw: Uint8Array, trackId: number): Uint8Array {
  const tkhd = find(children(raw, 8, raw.length), 'tkhd');
  if (!tkhd) return raw;
  const ver = raw[tkhd.start + 8];
  const off = tkhd.start + (ver === 1 ? 28 : 20);
  const out = new Uint8Array(raw);
  out.set([(trackId >>> 24) & 0xff, (trackId >>> 16) & 0xff, (trackId >>> 8) & 0xff, trackId & 0xff], off);
  return out;
}

function patchTkhdDuration(raw: Uint8Array, duration: number): Uint8Array {
  const tkhd = find(children(raw, 8, raw.length), 'tkhd');
  if (!tkhd) return raw;
  const ver = raw[tkhd.start + 8];
  const off = tkhd.start + (ver === 1 ? 28 : 20);
  const out = new Uint8Array(raw);
  out.set([(duration >>> 24) & 0xff, (duration >>> 16) & 0xff, (duration >>> 8) & 0xff, duration & 0xff], off);
  return out;
}

// fragmented inits carry an edts whose elst has empty edits (media_time -1);
// readers use those as stream duration, so drop the box for reassembled files
function stripEdts(raw: Uint8Array): Uint8Array {
  const all = children(raw, 8, raw.length);
  const kids = all.filter((kid) => kid.type !== 'edts');
  if (kids.length === all.length) return raw;
  const pieces = [raw.subarray(0, 8), ...kids.map((kid) => raw.subarray(kid.start, kid.end))];
  // size field stale after removal; re-wrap as a box
  return box('trak', concat(...pieces).subarray(8));
}

function fakeTrack(track: FragTrack, stcoValues: number[], trackId = track.id): Mp4Track {
  const sizes = track.samples.map((sample) => sample.size);
  const durations = track.samples.map((sample) => sample.duration);
  const sampleCounts = chunkSampleCounts(track);
  const chunkSizes = sampleCounts.map((num, i) => {
    const start = i === 0 ? 0 : track.chunkStarts[i - 1];
    let sum = 0;
    for (let j = start; j < start + num; j++) sum += track.samples[j].size;
    return sum;
  });
  const ctts = cttsBox(track.samples.map((s) => s.cto));
  const stbl = box('stbl', concat(
    stsdRaw(track),
    sttsBox(durations),
    ctts ?? new Uint8Array(0),
    stszBox(sizes),
    stscBox(chunkSampleCounts(track)),
    stcoBox(stcoValues)
  ));
  let raw = patchMdhdDuration(track.initRaw, durations.reduce((sum, d) => sum + d, 0));
  if (trackId !== track.id) raw = patchTkhdId(raw, trackId);
  raw = patchTkhdDuration(raw, durations.reduce((sum, d) => sum + d, 0));
  raw = stripEdts(raw);
  const mdiaStart = find(children(raw, 8, raw.length), 'mdia');
  const minf = mdiaStart ? find(children(raw, mdiaStart.start + 8, mdiaStart.end), 'minf') : undefined;
  const stblBox = minf ? find(children(raw, minf.start + 8, minf.end), 'stbl') : undefined;
  if (!mdiaStart || !minf || !stblBox) throw new Error('stbl patch failed');
  const oldStblLen = stblBox.end - stblBox.start;
  const delta = stbl.length - oldStblLen;
  const patched = concat(
    raw.subarray(0, stblBox.start),
    stbl,
    raw.subarray(stblBox.end)
  );
  // inner init size fields are stale after the stbl swap (mdia/minf sizes)
  setU32(patched, mdiaStart.start, (mdiaStart.end - mdiaStart.start) + delta);
  setU32(patched, minf.start, (minf.end - minf.start) + delta);
  const stblRegion = patched.subarray(stblBox.start, stblBox.start + stbl.length);
  const stcoOff = find(children(stblRegion, 8, stblRegion.length), 'stco') ?? find(children(stblRegion, 8, stblRegion.length), 'co64');
  if (!stcoOff) throw new Error(`no stco in fresh trak stsd=${Array.from(stsdRaw(track).subarray(0, 24))}`);
  // init trak's size field is stale after the stbl swap; re-wrap as a box
  const trak = box('trak', patched.subarray(8));
  const stcoShift = stblBox.start;
  const duration = durations.reduce((sum, d) => sum + d, 0);
  return {
    id: trackId,
    kind: track.kind,
    timescale: track.timescale,
    duration,
    raw: trak,
    stco: { start: stcoShift + stcoOff.start, end: stcoShift + stcoOff.end, co64: stcoOff.type === 'co64', values: stcoValues },
    stsz: { fixed: sizes.every((s) => s === sizes[0]) ? sizes[0] : 0, sizes },
    stsc: chunkSampleCounts(track).map((num, i) => ({ firstChunk: i + 1, samplesPerChunk: num })),
    stts: (() => {
      const runs: { count: number; delta: number }[] = [];
      for (const d of durations) {
        const last = runs[runs.length - 1];
        if (last && last.delta === d) last.count += 1;
        else runs.push({ count: 1, delta: d });
      }
      return runs;
    })(),
    chunkSizes,
  };
}

export interface FragSource {
  path: string;
  info: FragmentsInfo;
}

// rebuild one or more fragmented sources (hls concats) into one progressive
// mp4, keeping tracks that pass the filter; ids are deduped when they collide.
export async function assembleSources(
  io: MediaIO,
  outPath: string,
  sources: FragSource[],
  pick: (track: FragTrack) => boolean
): Promise<void> {
  const chosen = sources.flatMap((source) =>
    source.info.tracks.filter(pick).map((track) => ({ track, source }))
  );
  const ids = chosen.map((item) => item.track.id);
  const dedupe = ids.some((id, i) => ids.indexOf(id) !== i);
  const fakes = chosen.map((item, i) => fakeTrack(item.track, chunkOffsetsPerSegment(item.track), dedupe ? i + 1 : item.track.id));
  const chunks = interleave(fakes);
  const movieTimescale = sources[0]?.info.movieTimescale || fakes[0]?.timescale || 1000;
  const info: Mp4Info = {
    ftyp: sources[0]?.info.ftyp ?? null,
    moov: new Uint8Array(0),
    movieTimescale,
    tracks: fakes,
    udta: sources[0]?.info.udta ?? null,
  };
  const plan = planOutput(info, fakes, chunks);
  const srcs: MuxSource[] = chosen.map((chosen) => ({ path: chosen.source.path, info }));
  const started = Date.now();
  await writeMuxed(io, outPath, plan, srcs, fakes);
  const dataBytes = chunks.reduce((acc, ch) => acc + ch.size, 0);
  log(
    'core',
    `hls concat ${fakes.length}t ${(dataBytes / 1e6).toFixed(1)}MB in ${Date.now() - started}ms (${io.copyRanges ? 'native' : 'js'})`
  );
}

// rebuild fragmented file into progressive mp4 at outPath
export async function assembleFragments(
  io: MediaIO,
  srcPath: string,
  outPath: string,
  info: FragmentsInfo
): Promise<void> {
  await assembleSources(io, outPath, [{ path: srcPath, info }], () => true);
}

// convenience: try to convert a downloaded hls file to a progressive mp4.
// returns false when the input isn't fragmented mp4 (caller falls back).
export async function hlsFileToProgressive(
  io: MediaIO,
  srcPath: string,
  outPath: string
): Promise<boolean> {
  const size = await io.size(srcPath);
  if (size < 8) return false;
  const top = await topLevelBoxes(io, srcPath, size);
  if (!top.some((bx) => bx.type === 'moof')) return false;
  const info = await readFragments(io, srcPath, size);
  if (!info) return false;
  await assembleFragments(io, srcPath, outPath, info);
  return true;
}

export function aacEsds(asc: Uint8Array): Uint8Array {
  const esdsLen = 3 + 2 + 3 + 13 + 5 + asc.length;
  const es = concat(
    be32(0),
    new Uint8Array([0x03, 0x80, 0x80, 0x80, esdsLen - 3]),
    be16(0),
    new Uint8Array([0x04, 0x80, 0x80, 0x80, 13 + asc.length]),
    new Uint8Array([0x40, 0x15]),
    new Uint8Array([0, 0, 0]),
    be32(128000),
    be32(128000),
    new Uint8Array([0x05, 0x80, 0x80, 0x80, asc.length]),
    asc
  );
  return box('esds', es);
}
