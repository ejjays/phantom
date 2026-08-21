import { ascii, be16, be32, box, concat } from '../boxes';
import type { MediaIO } from '../io';
import { error as logError, log } from '../../log';
import { aacEsds } from '../mp4/fragments';
import { RATES, type AdtsInfo } from './demux';

// muxed mpeg-ts (hls: h264 + adts aac) -> progressive mp4, -c copy style.
// phase 1 scans packet streams recording per-frame spans + timestamps;
// phase 2 rewrites video frames annex-b -> avcc into a temp raw file;
// phase 3 assembles the mp4 and moves bytes with the native range mover.
// per-pid pes payloads are treated as file-contiguous (standard hls muxers
// write one pes back-to-back), matching the proven audio-only demuxer.

const TS_PACKET = 188;
const SYNC = 0x47;
const PAT_PID = 0;
const AAC_STREAM = 0x0f;
const H264_STREAM = 0x1b;

const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

interface Piece {
  offset: number;
  length: number;
}

interface VideoFrame {
  pieces: Piece[];
  pts: number;
  dts: number | null;
}

interface AudioFrame {
  offset: number;
  length: number;
}

interface ScanState {
  pmtPid: number | null;
  videoPid: number | null;
  audioPid: number | null;
  video: VideoFrame[];
  audio: AudioFrame[];
  audioInfo: AdtsInfo | null;
  vOpen: { pieces: Piece[]; pts: number; dts: number | null } | null;
  aBase: number;
  aParts: Uint8Array[];
}

function parseSection(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 2 || payload[0] !== 0) return null;
  const start = 1;
  if (start + 3 > payload.length) return null;
  const len = ((payload[start + 1] & 0x0f) << 8) | payload[start + 2];
  if (start + 3 + len > payload.length) return null;
  return payload.subarray(start, start + 3 + len);
}

function patPmtPid(section: Uint8Array): number | null {
  let pos = 8;
  while (pos + 4 <= section.length - 4) {
    const program = (section[pos] << 8) | section[pos + 1];
    if (program !== 0) return ((section[pos + 2] & 0x1f) << 8) | section[pos + 3];
    pos += 4;
  }
  return null;
}

function pmtStreams(section: Uint8Array): { type: number; pid: number }[] {
  const infoLen = ((section[10] & 0x0f) << 8) | section[11];
  const streams: { type: number; pid: number }[] = [];
  let pos = 12 + infoLen;
  while (pos + 5 <= section.length - 4) {
    streams.push({
      type: section[pos],
      pid: ((section[pos + 1] & 0x1f) << 8) | section[pos + 2],
    });
    pos += 5 + (((section[pos + 3] & 0x0f) << 8) | section[pos + 4]);
  }
  return streams;
}

function pesTimestamp(buf: Uint8Array, i: number): number {
  return (
    (((buf[i] & 0x0e) << 29) |
      (buf[i + 1] << 22) |
      ((buf[i + 2] & 0xfe) << 14) |
      (buf[i + 3] << 7) |
      ((buf[i + 4] & 0xfe) >>> 1)) >>>
    0
  );
}

function openPes(payload: Uint8Array): { skip: number; pts: number; dts: number | null } | null {
  if (payload.length < 9) return null;
  if (payload[0] !== 0 || payload[1] !== 0 || payload[2] !== 1) return null;
  const flags = payload[7];
  const skip = 9 + payload[8];
  if (payload.length < skip) return null;
  const hasPts = (flags & 0x80) !== 0;
  const pts = hasPts ? pesTimestamp(payload, 9) : 0;
  const dts = (flags & 0x40) !== 0 ? pesTimestamp(payload, 14) : null;
  return { skip, pts, dts };
}

function adtsHeader(data: Uint8Array, i: number): { len: number; header: number; freqIdx: number; chanCfg: number; profile: number } | null {
  if (data[i] !== 0xff || (data[i + 1] & 0xf0) !== 0xf0) return null;
  const protectionAbsent = (data[i + 1] & 0x01) !== 0;
  const len = ((data[i + 3] & 0x03) << 11) | (data[i + 4] << 3) | ((data[i + 5] >> 5) & 0x07);
  const header = 7 + (protectionAbsent ? 0 : 2);
  if (len < header || i + len > data.length) return null;
  return {
    len,
    header,
    profile: (data[i + 2] >> 6) & 0x03,
    freqIdx: (data[i + 2] >> 2) & 0x0f,
    chanCfg: ((data[i + 2] & 0x01) << 2) | ((data[i + 3] >> 6) & 0x03),
  };
}

function adtsScan(run: Uint8Array, base: number, state: ScanState): void {
  let i = 0;
  while (i + 7 <= run.length) {
    const hdr = adtsHeader(run, i);
    if (hdr === null) {
      i += 1;
      continue;
    }
    if (state.audioInfo === null) {
      if (hdr.freqIdx >= RATES.length) return;
      state.audioInfo = { sampleRate: RATES[hdr.freqIdx], channels: hdr.chanCfg, objectType: hdr.profile + 1 };
    } else if (state.audioInfo.sampleRate !== RATES[hdr.freqIdx]) {
      i += 1;
      continue;
    }
    state.audio.push({ offset: base + i + hdr.header, length: hdr.len - hdr.header });
    i += hdr.len;
  }
}

function flushAudio(state: ScanState): void {
  if (state.aParts.length === 0) return;
  const total = state.aParts.reduce((acc, part) => acc + part.length, 0);
  const run = new Uint8Array(total);
  let cursor = 0;
  for (const part of state.aParts) {
    run.set(part, cursor);
    cursor += part.length;
  }
  state.aParts = [];
  adtsScan(run, state.aBase, state);
}

function closeVideo(state: ScanState): void {
  if (state.vOpen === null) return;
  if (state.vOpen.pieces.length > 0) {
    state.video.push({ pieces: state.vOpen.pieces, pts: state.vOpen.pts, dts: state.vOpen.dts });
  }
  state.vOpen = null;
}

function feedVideo(state: ScanState, pusi: boolean, payload: Uint8Array, abs: number): void {
  if (!pusi) {
    if (state.vOpen !== null && payload.length > 0) {
      state.vOpen.pieces.push({ offset: abs, length: payload.length });
    }
    return;
  }
  closeVideo(state);
  const pes = openPes(payload);
  if (!pes) return;
  state.vOpen = { pieces: [], pts: pes.pts, dts: pes.dts };
  if (payload.length > pes.skip) {
    state.vOpen.pieces.push({ offset: abs + pes.skip, length: payload.length - pes.skip });
  }
}

function feedAudio(state: ScanState, pusi: boolean, payload: Uint8Array, abs: number): void {
  if (!pusi) {
    if (state.aParts.length > 0 && payload.length > 0) {
      state.aParts.push(payload.slice(0));
    }
    return;
  }
  flushAudio(state);
  const pes = openPes(payload);
  if (!pes) return;
  state.aBase = abs + pes.skip;
  state.aParts = [payload.slice(pes.skip)];
}

function feedPacket(state: ScanState, chunk: Uint8Array, pktPos: number, absBase: number): void {
  const pkt = chunk.subarray(pktPos, pktPos + TS_PACKET);
  const tei = (pkt[1] & 0x80) !== 0;
  const pusi = (pkt[1] & 0x40) !== 0;
  const pid = ((pkt[1] & 0x1f) << 8) | pkt[2];
  if (tei || (pkt[3] & 0x10) === 0) return;
  let payloadStart = 4;
  if ((pkt[3] & 0x20) !== 0) {
    payloadStart = 5 + pkt[4];
    if (payloadStart > TS_PACKET) payloadStart = TS_PACKET;
  }
  if (payloadStart >= TS_PACKET) return;
  const payload = pkt.subarray(payloadStart);
  const abs = absBase + pktPos + payloadStart;

  if (pid === PAT_PID && pusi) {
    const section = parseSection(payload);
    if (section) state.pmtPid ??= patPmtPid(section);
    return;
  }
  if (state.pmtPid !== null && pid === state.pmtPid && pusi) {
    const section = parseSection(payload);
    if (!section) return;
    for (const s of pmtStreams(section)) {
      if (s.type === H264_STREAM) state.videoPid ??= s.pid;
      else if (s.type === AAC_STREAM) state.audioPid ??= s.pid;
    }
    return;
  }
  if (state.videoPid !== null && pid === state.videoPid) return feedVideo(state, pusi, payload, abs);
  if (state.audioPid !== null && pid === state.audioPid) return feedAudio(state, pusi, payload, abs);
}

// ---- annex-b -> avcc ----

function findStartCode(data: Uint8Array, from: number): number {
  let i = from;
  while (i + 2 < data.length) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) return i;
    i += 1;
  }
  return -1;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

function pushUnique(list: Uint8Array[], nal: Uint8Array): void {
  if (!list.some((existing) => sameBytes(existing, nal))) list.push(nal.slice());
}

interface AvccResult {
  sample: Uint8Array;
  key: boolean;
}

function annexbToAvcc(es: Uint8Array, spsOut: Uint8Array[], ppsOut: Uint8Array[]): AvccResult | null {
  const parts: Uint8Array[] = [];
  let total = 0;
  let key = false;
  const first = findStartCode(es, 0);
  if (first < 0) return null;
  let nalStart = first + 3;
  while (nalStart < es.length) {
    const next = findStartCode(es, nalStart);
    // only the single optional zero_byte of the next code is stripped —
    // deeper trailing zeros are real nal payload (cabac zero words)
    let end = next < 0 ? es.length : next;
    if (end > nalStart && es[end - 1] === 0) end -= 1;
    const nal = es.subarray(nalStart, Math.max(end, nalStart));
    if (nal.length > 0) {
      const type = nal[0] & 0x1f;
      if (type === NAL_AUD) {
        // access-unit delimiters are redundant inside mp4 samples
      } else if (type === NAL_SPS) {
        pushUnique(spsOut, nal);
      } else if (type === NAL_PPS) {
        pushUnique(ppsOut, nal);
      } else {
        if (type === NAL_IDR) key = true;
        const prefix = new Uint8Array(4);
        new DataView(prefix.buffer).setUint32(0, nal.length);
        parts.push(prefix, nal.slice());
        total += 4 + nal.length;
      }
    }
    if (next < 0) break;
    nalStart = next + 3;
  }
  if (total === 0) return null;
  const sample = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    sample.set(part, cursor);
    cursor += part.length;
  }
  return { sample, key };
}

// ---- sps dimensions ----

class BitReader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  bit(): number {
    const bit = (this.data[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos += 1;
    return bit;
  }
  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.bit();
    return value;
  }
  golomb(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros += 1;
      if (zeros > 31) return 0;
    }
    return (1 << zeros) - 1 + this.bits(zeros);
  }
}

function scalingList(reader: BitReader, size: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const delta = reader.golomb();
      nextScale = (lastScale + delta + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

export function spsDimensions(sps: Uint8Array): { width: number; height: number } | null {
  try {
    const reader = new BitReader(sps);
    reader.bits(8); // nal header
    const profileIdc = reader.bits(8);
    reader.bits(16); // constraints + level
    reader.golomb(); // sps id
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
      const chroma = reader.golomb();
      if (chroma === 3) reader.bit();
      reader.golomb();
      reader.golomb();
      reader.bit();
      if (reader.bit()) scalingList(reader, chroma === 3 ? 12 : 8);
    }
    reader.golomb(); // log2 max frame num
    const pocType = reader.golomb();
    if (pocType === 0) reader.golomb();
    else if (pocType === 1) {
      reader.bit();
      reader.golomb();
      reader.golomb();
      const count = reader.golomb();
      for (let i = 0; i < count; i++) reader.golomb();
    }
    reader.golomb(); // max ref frames
    reader.bit(); // gaps allowed
    const widthMbs = reader.golomb() + 1;
    const heightMapUnits = reader.golomb() + 1;
    const frameMbsOnly = reader.bit() === 1;
    if (!frameMbsOnly) reader.bit();
    reader.bit(); // direct 8x8
    let cropL = 0;
    let cropR = 0;
    let cropT = 0;
    let cropB = 0;
    if (reader.bit()) {
      cropL = reader.golomb();
      cropR = reader.golomb();
      cropT = reader.golomb();
      cropB = reader.golomb();
    }
    const width = widthMbs * 16 - (cropL + cropR) * 2;
    const unitY = frameMbsOnly ? 2 : 4;
    const height = (frameMbsOnly ? 1 : 2) * heightMapUnits * 16 - (cropT + cropB) * unitY;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ---- boxes ----

function avcCBox(spsList: Uint8Array[], ppsList: Uint8Array[]): Uint8Array {
  const sps = spsList[0];
  const head = new Uint8Array([1, sps[1], sps[2], sps[3], 0xff, 0xe0 | spsList.length]);
  const parts: Uint8Array[] = [head];
  for (const item of spsList) parts.push(concat(be16(item.length), item));
  parts.push(new Uint8Array([ppsList.length]));
  for (const item of ppsList) parts.push(concat(be16(item.length), item));
  return box('avcC', concat(...parts));
}

function avc1Box(width: number, height: number, spsList: Uint8Array[], ppsList: Uint8Array[]): Uint8Array {
  return box(
    'avc1',
    concat(
      new Uint8Array(6),
      be16(1),
      be16(0),
      be16(0),
      new Uint8Array(12),
      be16(width),
      be16(height),
      be32(0x00480000),
      be32(0x00480000),
      be32(0),
      be16(1),
      new Uint8Array(32),
      be16(0x0018),
      be16(0xffff),
      avcCBox(spsList, ppsList)
    )
  );
}

function sttsFrom(deltas: number[]): Uint8Array {
  const runs: { delta: number; count: number }[] = [];
  for (const delta of deltas) {
    const last = runs[runs.length - 1];
    if (last && last.delta === delta) last.count += 1;
    else runs.push({ delta, count: 1 });
  }
  return box('stts', concat(be32(0), be32(runs.length), ...runs.flatMap((run) => [be32(run.count), be32(run.delta)])));
}

function cttsFrom(offsets: number[]): Uint8Array | null {
  if (offsets.every((o) => o === 0)) return null;
  const runs: { offset: number; count: number }[] = [];
  for (const offset of offsets) {
    const last = runs[runs.length - 1];
    if (last && last.offset === offset) last.count += 1;
    else runs.push({ offset, count: 1 });
  }
  return box('ctts', concat(be32(0), be32(runs.length), ...runs.flatMap((run) => [be32(run.count), be32(run.offset)])));
}

function mediaHeader(handler: 'vide' | 'soun'): Uint8Array {
  return handler === 'vide'
    ? box('vmhd', concat(be32(0), be16(0), be16(0), be16(0), be16(0)))
    : box('smhd', concat(be32(0), be16(0), be16(0)));
}

function trakBox(opts: {
  trackId: number;
  timescale: number;
  duration: number;
  width: number;
  height: number;
  handler: 'vide' | 'soun';
  stbl: Uint8Array[];
}): Uint8Array {
  const mdia = box(
    'mdia',
    concat(
      box('mdhd', concat(be32(0), be32(0), be32(0), be32(opts.timescale), be32(opts.duration), be16(0x55c4), be16(0))),
      box('hdlr', concat(be32(0), be32(0), ascii(opts.handler), new Uint8Array(12), new Uint8Array(1))),
      box('minf', concat(mediaHeader(opts.handler), box('dinf', box('dref', concat(be32(0), be32(1), box('url ', be32(1))))), box('stbl', concat(...opts.stbl))))
    )
  );
  const tkhd = box(
    'tkhd',
    concat(
      be32(7),
      be32(0),
      be32(0),
      be32(opts.trackId),
      be32(0),
      be32(opts.duration),
      new Uint8Array(8),
      be16(0),
      be16(0),
      be16(0x0100),
      new Uint8Array(2),
      new Uint8Array(36),
      be32(opts.width << 16),
      be32(opts.height << 16)
    )
  );
  return box('trak', concat(tkhd, mdia));
}

interface ConvertedSample {
  offset: number;
  length: number;
  dts: number;
  cts: number;
  key: boolean;
}

async function convertVideoFrames(
  io: MediaIO,
  srcPath: string,
  frames: VideoFrame[],
  tempPath: string,
  spsList: Uint8Array[],
  ppsList: Uint8Array[]
): Promise<ConvertedSample[]> {
  await io.create(tempPath);
  const samples: ConvertedSample[] = [];
  let tempCursor = 0;
  for (const frame of frames) {
    const first = frame.pieces[0];
    const last = frame.pieces[frame.pieces.length - 1];
    const spanStart = first.offset;
    const span = await io.read(srcPath, spanStart, last.offset + last.length - spanStart);
    const es = new Uint8Array(span.length);
    let filled = 0;
    for (const piece of frame.pieces) {
      es.set(span.subarray(piece.offset - spanStart, piece.offset - spanStart + piece.length), filled);
      filled += piece.length;
    }
    const result = annexbToAvcc(es.subarray(0, filled), spsList, ppsList);
    if (!result) continue;
    await io.write(tempPath, result.sample, tempCursor);
    samples.push({
      offset: tempCursor,
      length: result.sample.length,
      dts: frame.dts ?? frame.pts,
      cts: frame.pts - (frame.dts ?? frame.pts),
      key: result.key,
    });
    tempCursor += result.sample.length;
  }
  return samples;
}

async function writeAssembled(
  io: MediaIO,
  outPath: string,
  srcPath: string,
  tempPath: string,
  samples: ConvertedSample[],
  audio: AudioFrame[],
  videoRun: number,
  audioRun: number
): Promise<void> {
  if (io.copyRanges) {
    const videoRanges: number[] = [];
    let videoCursor = videoRun;
    for (const sample of samples) {
      videoRanges.push(videoCursor, sample.offset, sample.length);
      videoCursor += sample.length;
    }
    await io.copyRanges(tempPath, outPath, videoRanges);
    if (audio.length > 0) {
      const audioRanges: number[] = [];
      let audioCursor = audioRun;
      for (const frame of audio) {
        audioRanges.push(audioCursor, frame.offset, frame.length);
        audioCursor += frame.length;
      }
      await io.copyRanges(srcPath, outPath, audioRanges);
    }
    return;
  }
  let videoCursor = videoRun;
  for (const sample of samples) {
    const bytes = await io.read(tempPath, sample.offset, sample.length);
    await io.write(outPath, bytes, videoCursor);
    videoCursor += sample.length;
  }
  let audioCursor = audioRun;
  for (const frame of audio) {
    const bytes = await io.read(srcPath, frame.offset, frame.length);
    await io.write(outPath, bytes, audioCursor);
    audioCursor += frame.length;
  }
}

export async function remuxTsToMp4(io: MediaIO, srcPath: string, outPath: string): Promise<boolean> {
  const started = Date.now();
  const size = await io.size(srcPath);
  if (size < TS_PACKET) return false;
  const head = await io.read(srcPath, 0, TS_PACKET);
  if (head[0] !== SYNC) return false;

  const state: ScanState = {
    pmtPid: null,
    videoPid: null,
    audioPid: null,
    video: [],
    audio: [],
    audioInfo: null,
    vOpen: null,
    aBase: 0,
    aParts: [],
  };
  const CHUNK = TS_PACKET * 5577;
  let offset = 0;
  while (offset < size) {
    const len = Math.min(CHUNK, size - offset);
    const chunk = await io.read(srcPath, offset, len);
    let pos = 0;
    while (pos + TS_PACKET <= chunk.length) {
      if (chunk[pos] !== SYNC) {
        pos += 1;
        continue;
      }
      feedPacket(state, chunk, pos, offset);
      pos += TS_PACKET;
    }
    offset += len;
  }
  closeVideo(state);
  flushAudio(state);

  const spsList: Uint8Array[] = [];
  const ppsList: Uint8Array[] = [];
  if (state.video.length === 0) return false;

  const tempPath = `${srcPath}.vt`;
  try {
    const samples = await convertVideoFrames(io, srcPath, state.video, tempPath, spsList, ppsList);
    if (samples.length === 0 || spsList.length === 0 || ppsList.length === 0) {
      logError('core', `ts remux refused: frames=${samples.length} sps=${spsList.length} pps=${ppsList.length}`);
      return false;
    }
    const dims = spsDimensions(spsList[0]);
    if (!dims) {
      logError('core', 'ts remux refused: sps unparsable');
      return false;
    }

    const dtsValues = samples.map((s) => s.dts);
    const deltas: number[] = [];
    for (let i = 1; i < dtsValues.length; i++) deltas.push(Math.max(0, dtsValues[i] - dtsValues[i - 1]));
    if (deltas.length === 0) deltas.push(3003);
    const videoDuration = dtsValues[dtsValues.length - 1] - dtsValues[0] + deltas[deltas.length - 1];
    const ctts = cttsFrom(samples.map((s) => s.cts));
    const keyIndices = samples.map((s, i) => (s.key ? be32(i + 1) : null)).filter((v): v is Uint8Array => v !== null);

    const audioTimescale = state.audioInfo?.sampleRate ?? 48000;
    const audioChannels = state.audioInfo?.channels ?? 2;
    const audioDuration = state.audio.length * 1024;
    const movieMs = Math.round(Math.max((videoDuration / 90000) * 1000, (audioDuration / audioTimescale) * 1000));

    const videoBytes = samples.reduce((acc, s) => acc + s.length, 0);
    const audioBytes = state.audio.reduce((acc, f) => acc + f.length, 0);

    const ftyp = box('ftyp', concat(ascii('isom'), be32(0x200), ascii('isom'), ascii('iso5'), ascii('mp41')));
    const mvhd = box(
      'mvhd',
      concat(be32(0), be32(0), be32(0), be32(1000), be32(movieMs), be32(0x00010000), be16(0x0100), be16(0), new Uint8Array(8), new Uint8Array(36), new Uint8Array(24), be32(3))
    );

    const asc = (() => {
      const freqIdx = RATES.indexOf(audioTimescale);
      const value = new Uint8Array(2);
      value[0] = (((state.audioInfo?.objectType ?? 2) << 3) & 0xf8) | ((freqIdx >> 1) & 0x07);
      value[1] = ((freqIdx & 0x01) << 7) | ((audioChannels & 0x0f) << 3);
      return value;
    })();
    const mp4a = concat(
      new Uint8Array(6),
      be16(1),
      be16(0),
      be16(0),
      new Uint8Array(4),
      be16(audioChannels),
      be16(16),
      be16(0),
      be16(0),
      be32(audioTimescale << 16),
      aacEsds(asc)
    );

    const buildMoov = (videoDataStart: number, audioDataStart: number): Uint8Array => {
      const videoStbl = [
        box('stsd', concat(be32(0), be32(1), avc1Box(dims.width, dims.height, spsList, ppsList))),
        sttsFrom(deltas),
        ...(ctts ? [ctts] : []),
        box('stsc', concat(be32(0), be32(1), be32(1), be32(samples.length), be32(1))),
        box('stsz', concat(be32(0), be32(0), be32(samples.length), ...samples.map((s) => be32(s.length)))),
        ...(keyIndices.length > 0 ? [box('stss', concat(be32(0), be32(keyIndices.length), ...keyIndices))] : []),
        box('stco', concat(be32(0), be32(1), be32(videoDataStart))),
      ];
      const audioStbl = [
        box('stsd', concat(be32(0), be32(1), box('mp4a', mp4a))),
        box('stts', concat(be32(0), be32(1), be32(state.audio.length), be32(1024))),
        box('stsc', concat(be32(0), be32(1), be32(1), be32(state.audio.length), be32(1))),
        box('stsz', concat(be32(0), be32(0), be32(state.audio.length), ...state.audio.map((f) => be32(f.length)))),
        box('stco', concat(be32(0), be32(1), be32(audioDataStart))),
      ];
      return box(
        'moov',
        concat(
          mvhd,
          trakBox({ trackId: 1, timescale: 90000, duration: videoDuration, width: dims.width, height: dims.height, handler: 'vide', stbl: videoStbl }),
          trakBox({ trackId: 2, timescale: audioTimescale, duration: audioDuration, width: 0, height: 0, handler: 'soun', stbl: audioStbl })
        )
      );
    };

    // phase 3: assemble final mp4
    const probe = buildMoov(0, 0);
    const headerSize = ftyp.length + probe.length + 8;
    const videoRun = headerSize;
    const audioRun = videoRun + videoBytes;
    const moovFinal = buildMoov(videoRun, audioRun);
    const totalBytes = videoBytes + audioBytes;
    const mdatHeader = new Uint8Array(8);
    new DataView(mdatHeader.buffer).setUint32(0, totalBytes + 8);
    mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);

    await io.create(outPath);
    await io.write(outPath, ftyp, 0);
    await io.write(outPath, moovFinal, ftyp.length);
    await io.write(outPath, mdatHeader, ftyp.length + moovFinal.length);
    await writeAssembled(io, outPath, srcPath, tempPath, samples, state.audio, videoRun, audioRun);

    const expected = headerSize + totalBytes;
    const actual = await io.size(outPath);
    const ok = actual === expected;
    if (!ok) {
      logError('core', `ts remux size mismatch ${actual} != ${expected}`);
    } else {
      log(
        'core',
        `ts mp4 ${samples.length}vf+${state.audio.length}af ${(totalBytes / 1e6).toFixed(1)}MB ${dims.width}x${dims.height} in ${Date.now() - started}ms (${io.copyRanges ? 'native' : 'js'})`
      );
    }
    return ok;
  } finally {
    try {
      await io.delete(tempPath);
    } catch {
      /* temp never created */
    }
  }
}
