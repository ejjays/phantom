import { box, be16, be32, concat } from '../boxes';
import type { MediaIO } from '../io';
import type { Mp4Info, Mp4Track } from './reader';
import { spliceStco } from './reader';

export interface ChunkRef {
  track: number;
  chunk: number;
  size: number;
  offset: number;
}

export interface MuxPlan {
  ftyp: Uint8Array | null;
  moov: Uint8Array;
  chunks: ChunkRef[];
  mdatPayload: number;
  mdatHeader: number;
}

// interleave by chunk index, video before audio per index
export function interleave(tracks: Mp4Track[]): ChunkRef[] {
  const counts = tracks.map((t) => t.stco.values.length);
  const maxChunks = Math.max(0, ...counts);
  const plan: ChunkRef[] = [];
  for (let i = 0; i < maxChunks; i++) {
    for (let t = 0; t < tracks.length; t++) {
      if (i < counts[t]) {
        plan.push({ track: t, chunk: i, size: tracks[t].chunkSizes[i], offset: 0 });
      }
    }
  }
  return plan;
}

function trackDurationScaled(track: Mp4Track, movieTimescale: number): number {
  return Math.ceil((track.duration * movieTimescale) / track.timescale);
}

export function buildMoov(
  tracks: Mp4Track[],
  chunkOffsets: number[][],
  movieTimescale: number,
  udta: Uint8Array | null
): Uint8Array {
  const movieDuration = Math.max(
    0,
    ...tracks.map((t) => trackDurationScaled(t, movieTimescale))
  );
  const nextTrackId = Math.max(0, ...tracks.map((t) => t.id)) + 1;
  const traks = tracks.map((t, i) => spliceStco(t.raw, t.stco, chunkOffsets[i]));
  const parts: Uint8Array[] = [box('mvhd', mvhdPayload(movieTimescale, movieDuration, nextTrackId)), ...traks];
  if (udta) parts.push(udta);
  return box('moov', concat(...parts));
}

function mvhdPayload(timescale: number, duration: number, nextTrackId: number): Uint8Array {
  const identity = new Uint8Array(36);
  const view = new DataView(identity.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(16, 0x00010000);
  view.setUint32(32, 0x40000000);
  return concat(
    be32(0),
    be32(0),
    be32(0),
    be32(timescale),
    be32(duration),
    be32(0x00010000),
    be16(0x0100),
    be16(0),
    new Uint8Array(8),
    identity,
    new Uint8Array(24),
    be32(nextTrackId)
  );
}

function moovSize(tracks: Mp4Track[], chunkOffsets: number[][], movieTimescale: number, udta: Uint8Array | null): number {
  return buildMoov(tracks, chunkOffsets, movieTimescale, udta).length;
}

// ftyp + moov + mdat, moov first (faststart); chunk offsets precomputed so the
// moov is written once, then mdat streams straight from source files.
export function planOutput(
  info: Mp4Info,
  tracks: Mp4Track[],
  chunks: ChunkRef[],
  udtaOverride?: Uint8Array | null
): MuxPlan {
  const movieTimescale = info.movieTimescale || tracks[0].timescale;
  const udta = udtaOverride === undefined ? info.udta : udtaOverride;
  const totalBytes = chunks.reduce((acc, ch) => acc + ch.size, 0);
  const mdatHeader = totalBytes >= 0xffffffff - 8 ? 16 : 8;

  // placeholder stco with real entry count (values don't affect box size)
  let offsets: number[][] = tracks.map((t) => t.stco.values.map(() => 0));
  for (let pass = 0; pass < 3; pass++) {
    const ftypSize = info.ftyp?.length ?? 0;
    const moovSizeNow = moovSize(tracks, offsets, movieTimescale, udta);
    const dataStart = ftypSize + moovSizeNow + mdatHeader;
    let cursor = dataStart;
    for (const ch of chunks) {
      ch.offset = cursor;
      cursor += ch.size;
    }
    offsets = tracks.map((_, tIdx) =>
      chunks.filter((ch) => ch.track === tIdx).map((ch) => ch.offset)
    );
    const overflow = offsets.some((list) => list.some((v) => v > 0xfffffff0));
    if (!overflow) break;
  }

  const moov = buildMoov(tracks, offsets, movieTimescale, udta);
  const mdatPayload = chunks.length > 0 ? chunks[0].offset : 0;
  return { ftyp: info.ftyp, moov, chunks, mdatPayload, mdatHeader };
}

async function writeMdatHeader(
  io: MediaIO,
  outPath: string,
  payloadOffset: number,
  total: number
): Promise<void> {
  const large = total >= 0xffffffff - 8;
  const header = new Uint8Array(large ? 16 : 8);
  const view = new DataView(header.buffer);
  if (large) {
    view.setUint32(0, 1);
    header.set([0x6d, 0x64, 0x61, 0x74], 4);
    view.setBigUint64(8, BigInt(total));
  } else {
    view.setUint32(0, total + 8);
    header.set([0x6d, 0x64, 0x61, 0x74], 4);
  }
  await io.write(outPath, header, payloadOffset - header.length);
}

export interface MuxSource {
  path: string;
  info: Mp4Info;
}

export async function writeMuxed(
  io: MediaIO,
  outPath: string,
  plan: MuxPlan,
  sources: MuxSource[],
  tracks: Mp4Track[]
): Promise<void> {
  await io.create(outPath);
  let offset = 0;
  if (plan.ftyp) {
    await io.write(outPath, plan.ftyp, 0);
    offset = plan.ftyp.length;
  }
  await io.write(outPath, plan.moov, offset);
  const total = plan.chunks.reduce((acc, ch) => acc + ch.size, 0);
  if (total > 0) {
    await writeMdatHeader(io, outPath, plan.mdatPayload, total);
  }
  if (io.copyRanges) {
    // one native call per source; bytes never enter js
    for (let t = 0; t < sources.length; t++) {
      const ranges: number[] = [];
      for (const ch of plan.chunks) {
        if (ch.track !== t) continue;
        ranges.push(ch.offset, tracks[t].stco.values[ch.chunk], ch.size);
      }
      if (ranges.length > 0) {
        await io.copyRanges(sources[t].path, outPath, ranges);
      }
    }
    return;
  }
  for (const ch of plan.chunks) {
    const src = sources[ch.track];
    const track = tracks[ch.track];
    const bytes = await io.read(src.path, track.stco.values[ch.chunk], ch.size);
    await io.write(outPath, bytes, ch.offset);
  }
}