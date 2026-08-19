import { concat, u32, u64, fourcc } from '../boxes';
import type { MediaIO } from '../io';

export interface BoxHeader {
  type: string;
  size: number;
  headerSize: number;
  offset: number;
}

export interface MemBox {
  type: string;
  start: number;
  end: number;
}

export interface StscRun {
  firstChunk: number;
  samplesPerChunk: number;
}

export interface Mp4Track {
  id: number;
  kind: 'video' | 'audio';
  timescale: number;
  duration: number;
  raw: Uint8Array;
  stco: { start: number; end: number; co64: boolean; values: number[] };
  stsz: { fixed: number; sizes: number[] };
  stsc: StscRun[];
  stts: { count: number; delta: number }[];
  chunkSizes: number[];
}

export interface Mp4Info {
  ftyp: Uint8Array | null;
  moov: Uint8Array;
  movieTimescale: number;
  tracks: Mp4Track[];
  udta: Uint8Array | null;
}

export async function topLevelBoxes(
  io: MediaIO,
  path: string,
  fileSize: number
): Promise<BoxHeader[]> {
  const boxes: BoxHeader[] = [];
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const head = await io.read(path, offset, 8);
    let size = u32(head, 0);
    const type = fourcc(head, 4);
    let headerSize = 8;
    if (size === 1) {
      const ext = await io.read(path, offset + 8, 8);
      size = u64(ext, 0);
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    boxes.push({ type, size, headerSize, offset });
    if (size <= 0) break;
    offset += size;
  }
  return boxes;
}

export function children(bytes: Uint8Array, start: number, limit: number): MemBox[] {
  const out: MemBox[] = [];
  let off = start;
  while (off + 8 <= limit) {
    const size = u32(bytes, off);
    const type = fourcc(bytes, off + 4);
    const full = size === 1 ? u64(bytes, off + 8) : size === 0 ? limit - off : size;
    if (full <= 0) break;
    out.push({ type, start: off, end: off + full });
    off += full;
  }
  return out;
}

export function find(boxes: MemBox[], type: string): MemBox | undefined {
  return boxes.find((box) => box.type === type);
}

function parseTable(bytes: Uint8Array, box: MemBox, entrySize: number): number[][] {
  const count = u32(bytes, box.start + 12);
  const entries: number[][] = [];
  let off = box.start + 16;
  for (let i = 0; i < count; i++) {
    const entry: number[] = [];
    for (let j = 0; j < entrySize; j++) {
      entry.push(u32(bytes, off + j * 4));
    }
    entries.push(entry);
    off += entrySize * 4;
  }
  return entries;
}

function parseTrack(raw: Uint8Array): Mp4Track | null {
  const trak = children(raw, 8, raw.length);
  const tkhd = find(trak, 'tkhd');
  const mdia = find(trak, 'mdia');
  if (!tkhd || !mdia) return null;
  const tkhdVer = raw[tkhd.start + 8];
  const id = u32(raw, tkhd.start + (tkhdVer === 1 ? 28 : 20));

  const mdiaBoxes = children(raw, mdia.start + 8, mdia.end);
  const mdhd = find(mdiaBoxes, 'mdhd');
  const hdlr = find(mdiaBoxes, 'hdlr');
  if (!mdhd || !hdlr) return null;
  const mdhdVer = raw[mdhd.start + 8];
  // v0: creation+modification at +12/+16, timescale +20, duration +24; v1: 8-byte times
  const timescale = u32(raw, mdhd.start + (mdhdVer === 1 ? 28 : 20));
  const mdhdDuration = mdhdVer === 1 ? u64(raw, mdhd.start + 32) : u32(raw, mdhd.start + 24);
  const handler = fourcc(raw, hdlr.start + 16);
  if (handler !== 'vide' && handler !== 'soun') return null;

  const minf = find(mdiaBoxes, 'minf');
  if (!minf) return null;
  const minfBoxes = children(raw, minf.start + 8, minf.end);
  const stbl = find(minfBoxes, 'stbl');
  if (!stbl) return null;
  const stblBoxes = children(raw, stbl.start + 8, stbl.end);
  const sttsBox = find(stblBoxes, 'stts');
  const stscBox = find(stblBoxes, 'stsc');
  const stszBox = find(stblBoxes, 'stsz');
  const stcoBox = find(stblBoxes, 'stco') ?? find(stblBoxes, 'co64');
  if (!sttsBox || !stscBox || !stszBox || !stcoBox) return null;

  const stts = parseTable(raw, sttsBox, 2).map(([count, delta]) => ({ count, delta }));
  const stsc = parseTable(raw, stscBox, 3).map(([firstChunk, samplesPerChunk]) => ({
    firstChunk,
    samplesPerChunk,
  }));

  const fixed = u32(raw, stszBox.start + 12);
  const sampleCount = u32(raw, stszBox.start + 16);
  const sizes: number[] = [];
  if (fixed === 0) {
    let off = stszBox.start + 20;
    for (let i = 0; i < sampleCount; i++) {
      sizes.push(u32(raw, off));
      off += 4;
    }
  }

  const co64 = stcoBox.type === 'co64';
  const entryCount = u32(raw, stcoBox.start + 12);
  const values: number[] = [];
  let off = stcoBox.start + 16;
  for (let i = 0; i < entryCount; i++) {
    values.push(co64 ? u64(raw, off) : u32(raw, off));
    off += co64 ? 8 : 4;
  }

  const chunkSizes: number[] = [];
  let sampleIdx = 0;
  for (let chunk = 0; chunk < values.length; chunk++) {
    let samplesPerChunk = 1;
    for (const run of stsc) {
      if (run.firstChunk <= chunk + 1) samplesPerChunk = run.samplesPerChunk;
      else break;
    }
    let size = 0;
    for (let s = 0; s < samplesPerChunk; s++) {
      size += fixed === 0 ? sizes[sampleIdx] : fixed;
      sampleIdx++;
    }
    chunkSizes.push(size);
  }

  let duration = 0;
  for (const { count, delta } of stts) duration += count * delta;
  if (duration === 0) duration = mdhdDuration;

  return {
    id,
    kind: handler === 'vide' ? 'video' : 'audio',
    timescale,
    duration,
    raw,
    stco: { start: stcoBox.start, end: stcoBox.end, co64, values },
    stsz: { fixed, sizes },
    stsc,
    stts,
    chunkSizes,
  };
}

export async function parseMp4(
  io: MediaIO,
  path: string,
  fileSize: number
): Promise<Mp4Info> {
  const top = await topLevelBoxes(io, path, fileSize);
  const ftypBox = top.find((box) => box.type === 'ftyp');
  const moovBox = top.find((box) => box.type === 'moov');
  if (!moovBox) throw new Error('no moov');
  const ftyp = ftypBox ? await io.read(path, ftypBox.offset, ftypBox.size) : null;
  const moov = await io.read(path, moovBox.offset, moovBox.size);

  const mvhd = find(children(moov, 8, moov.length), 'mvhd');
  let movieTimescale = 1000;
  if (mvhd) {
    const mvhdVer = moov[mvhd.start + 8];
    // v0: creation+modification at +12/+16, timescale +20; v1: 8-byte times -> +24
    movieTimescale = u32(moov, mvhd.start + (mvhdVer === 1 ? 24 : 20));
  }

  const tracks: Mp4Track[] = [];
  for (const trakBox of children(moov, 8, moov.length)) {
    if (trakBox.type !== 'trak') continue;
    const raw = moov.subarray(trakBox.start, trakBox.end);
    const track = parseTrack(raw);
    if (track) tracks.push(track);
  }

  const udtaBox = find(children(moov, 8, moov.length), 'udta');
  const udta = udtaBox ? moov.subarray(udtaBox.start, udtaBox.end) : null;
  return { ftyp, moov, movieTimescale, tracks, udta };
}

// rebuild stco/co64 with new chunk offsets; source table type kept unless
// offsets push past 4GB (co64). returns new raw trak bytes.
export function spliceStco(
  raw: Uint8Array,
  stco: { start: number; end: number; co64: boolean },
  values: number[]
): Uint8Array {
  const co64 = stco.co64 || values.some((v) => v > 0xfffffff0);
  const size = 8 + 4 + 4 + values.length * (co64 ? 8 : 4);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size);
  out.set([0x73, 0x74, 0x63, co64 ? 0x36 : 0x6f], 4);
  view.setUint32(8, 0);
  view.setUint32(12, values.length);
  let off = 16;
  for (const value of values) {
    if (co64) view.setBigUint64(off, BigInt(value));
    else view.setUint32(off, value >>> 0);
    off += co64 ? 8 : 4;
  }
  return concat(raw.subarray(0, stco.start), out, raw.subarray(stco.end));
}