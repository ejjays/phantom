// webm -> progressive mp4 (faststart), -c copy equivalent: vp09 + opus
// sample entries with vpcC/dOps configs from codec private data.

import { ascii, be16, be32, box, boxRaw, concat, mvhd } from '../boxes';
import type { MediaIO } from '../io';
import { scanWebm, WebmScan, WebmTrack } from './demux';

export interface WebmSource {
  path: string;
  kind: 'video' | 'audio';
}

interface Sample {
  ts: number;
  delta: number;
  size: number;
  offset: number;
  key: boolean;
}

interface TrackPlan {
  path: string;
  kind: 'video' | 'audio';
  meta: WebmTrack;
  timescale: number;
  duration: number;
  samples: Sample[];
}

const VIDEO_TS = 90000;
const IDENTITY_MATRIX = new Uint8Array(36);
(() => {
  const view = new DataView(IDENTITY_MATRIX.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(16, 0x00010000);
  view.setUint32(32, 0x40000000);
})();

interface FrameLike {
  ts: number;
  size: number;
  offset: number;
  key: boolean;
}

function scaled(samples: FrameLike[], timescale: number): Sample[] {
  const out: Sample[] = [];
  let prev = -1;
  for (const frame of samples) {
    let ts = Math.floor((frame.ts * timescale) / 1000);
    if (ts <= prev) ts = prev + 1;
    prev = ts;
    out.push({ ...frame, ts, delta: 0 });
  }
  return out;
}

// per-frame deltas; last frame borrows the previous delta (or defaultDuration)
function withDeltas(
  samples: Sample[],
  timescale: number,
  fallbackNs: number
): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const next = samples[i + 1];
    let delta = next ? next.ts - samples[i].ts : 0;
    if (delta <= 0) {
      delta =
        fallbackNs > 0
          ? Math.max(1, Math.round((fallbackNs * timescale) / 1000000000))
          : 1;
      if (i > 0) delta = out[i - 1].delta;
    }
    out.push({ ...samples[i], delta });
  }
  return out;
}

function sttsRuns(samples: Sample[]): Uint8Array {
  const runs: { count: number; delta: number }[] = [];
  for (const sample of samples) {
    const last = runs[runs.length - 1];
    if (last && last.delta === sample.delta) last.count++;
    else runs.push({ count: 1, delta: sample.delta });
  }
  return box(
    'stts',
    concat(
      be32(0),
      be32(runs.length),
      ...runs.flatMap((run) => [be32(run.count), be32(run.delta)])
    )
  );
}

function stszBox(sizes: number[]): Uint8Array {
  return box(
    'stsz',
    concat(be32(0), be32(0), be32(sizes.length), ...sizes.map((s) => be32(s)))
  );
}

function stcoBox(offsets: number[]): Uint8Array {
  const co64 = offsets.some((v) => v > 0xfffffff0);
  const entries = offsets.map((v) => {
    if (co64) {
      const out = new Uint8Array(8);
      new DataView(out.buffer).setBigUint64(0, BigInt(v));
      return out;
    }
    return be32(v);
  });
  return box(
    co64 ? 'co64' : 'stco',
    concat(be32(0), be32(entries.length), ...entries)
  );
}

function stssBox(keys: number[]): Uint8Array {
  if (keys.length === 0) return new Uint8Array(0);
  return box('stss', concat(be32(0), be32(keys.length), ...keys.map((k) => be32(k))));
}

function vpcCBox(track: WebmTrack): Uint8Array {
  const priv = track.codecPrivate;
  // webm vp9 priv: profile, level, bitdepth/chroma/range, colour, transfer,
  // matrix — bt709/limited defaults when priv is absent
  const config =
    priv && priv.length >= 3
      ? new Uint8Array([
          priv[0],
          priv[1],
          priv[2],
          priv[3] ?? 0,
          priv[4] ?? 0,
          priv[5] ?? 0,
          0,
          0,
        ])
      : new Uint8Array([0x14, 0x82, 0x02, 0x02, 0x02, 0x00, 0x00, 0x00]);
  return box('vpcC', concat(be32(0x01000000), config));
}

function dOpsBox(track: WebmTrack): Uint8Array {
  let preSkip = 312;
  let rate = track.sampleRate || 48000;
  let gain = 0;
  let family = 0;
  const priv = track.codecPrivate;
  if (priv && priv.length >= 19) {
    // private data = 'OpusHead' magic (8) + config
    preSkip = priv[10] | (priv[11] << 8);
    rate = priv[12] | (priv[13] << 8) | (priv[14] << 16) | (priv[15] << 24);
    gain = priv[16] | (priv[17] << 8);
    family = priv[18];
  }
  const le16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const le32 = (v: number): Uint8Array =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  return box(
    'dOps',
    concat(
      new Uint8Array([0, track.channels || 2]),
      le16(preSkip),
      le32(rate),
      le16(gain),
      new Uint8Array([family])
    )
  );
}

function stsdBox(track: TrackPlan): Uint8Array {
  if (track.kind === 'video') {
    const entry = concat(
      new Uint8Array(6),
      be16(1),
      be16(0),
      be16(0),
      new Uint8Array(12),
      be16(track.meta.width || 0),
      be16(track.meta.height || 0),
      be32(0x00480000),
      be32(0x00480000),
      be32(0),
      be16(1),
      new Uint8Array(32),
      be16(0x18),
      be16(0xffff),
      vpcCBox(track.meta)
    );
    return box('stsd', concat(be32(0), be32(1), boxRaw(ascii('vp09'), entry)));
  }
  const entry = concat(
    new Uint8Array(6),
    be16(1),
    new Uint8Array(8),
    be16(track.meta.channels || 2),
    be16(16),
    be16(0),
    be16(0),
    be32((track.meta.sampleRate || 48000) << 16),
    dOpsBox(track.meta)
  );
  return box('stsd', concat(be32(0), be32(1), boxRaw(ascii('Opus'), entry)));
}

function tkhdBox(track: TrackPlan, movieTs: number, id: number): Uint8Array {
  const dur = Math.max(0, Math.ceil((track.duration * movieTs) / track.timescale));
  const video = track.kind === 'video';
  const payload = concat(
    be32(0x00000003),
    be32(0),
    be32(0),
    be32(id),
    be32(0),
    be32(dur),
    new Uint8Array(8),
    be16(0),
    be16(0),
    be16(video ? 0 : 0x0100),
    be16(0),
    IDENTITY_MATRIX,
    be32(video ? (track.meta.width || 0) << 16 : 0),
    be32(video ? (track.meta.height || 0) << 16 : 0)
  );
  return box('tkhd', payload);
}

function mdhdBox(track: TrackPlan): Uint8Array {
  return box(
    'mdhd',
    concat(
      be32(0),
      be32(0),
      be32(0),
      be32(track.timescale),
      be32(track.duration),
      be16(0x55c4),
      be16(0)
    )
  );
}

function hdlrBox(kind: 'video' | 'audio'): Uint8Array {
  return box(
    'hdlr',
    concat(be32(0), be32(0), ascii(kind === 'video' ? 'vide' : 'soun'), new Uint8Array(12), new Uint8Array(1))
  );
}

function stblBox(track: TrackPlan, offsets: number[]): Uint8Array {
  const sizes = track.samples.map((s) => s.size);
  const keys: number[] = [];
  if (track.kind === 'video') {
    track.samples.forEach((s, i) => {
      if (s.key) keys.push(i + 1);
    });
  }
  return box(
    'stbl',
    concat(
      stsdBox(track),
      sttsRuns(track.samples),
      box('stsc', concat(be32(0), be32(1), be32(1), be32(1), be32(1))),
      stszBox(sizes),
      stcoBox(offsets),
      stssBox(keys)
    )
  );
}

function minfBox(track: TrackPlan, offsets: number[]): Uint8Array {
  const mediaHeader =
    track.kind === 'video'
      ? box('vmhd', concat(be32(0x00000001), be16(0), new Uint8Array(6)))
      : box('smhd', concat(be32(0), be16(0), be16(0)));
  const dref = box(
    'dinf',
    box('dref', concat(be32(0), be32(1), box('url ', be32(0x00000001))))
  );
  return box('minf', concat(mediaHeader, dref, stblBox(track, offsets)));
}

function trakBox(track: TrackPlan, movieTs: number, id: number, offsets: number[]): Uint8Array {
  return box(
    'trak',
    concat(
      tkhdBox(track, movieTs, id),
      box(
        'mdia',
        concat(mdhdBox(track), hdlrBox(track.kind), minfBox(track, offsets))
      )
    )
  );
}

function ftypBox(): Uint8Array {
  return box(
    'ftyp',
    concat(ascii('isom'), be32(0x200), ascii('isom'), ascii('iso5'), ascii('mp41'))
  );
}

function moovBox(tracks: TrackPlan[], offsets: number[][]): Uint8Array {
  const movieTs = 1000;
  const duration = Math.max(0, ...tracks.map((t) => tkhdDuration(t, movieTs)));
  return box(
    'moov',
    concat(mvhd(movieTs, duration, tracks.length + 1), ...tracks.map((t, i) => trakBox(t, movieTs, i + 1, offsets[i])))
  );
}

function tkhdDuration(track: TrackPlan, movieTs: number): number {
  return Math.max(0, Math.ceil((track.duration * movieTs) / track.timescale));
}

async function scanSource(
  io: MediaIO,
  source: WebmSource,
  cache: Map<string, WebmScan>
): Promise<TrackPlan | null> {
  let scan: WebmScan | null | undefined = cache.get(source.path);
  if (!scan) {
    scan = await scanWebm(io, source.path, await io.size(source.path));
    if (!scan) return null;
    cache.set(source.path, scan);
  }
  const meta = scan.tracks.find((t) => t.kind === source.kind);
  if (!meta) return null;
  const frames = scan.frames.filter((f) => f.track === meta.number);
  if (frames.length === 0) return null;
  const timescale = source.kind === 'video' ? VIDEO_TS : meta.sampleRate || 48000;
  const samples = withDeltas(
    scaled(frames, timescale),
    timescale,
    meta.defaultDuration
  );
  const duration = samples[samples.length - 1].ts + samples[samples.length - 1].delta;
  return { path: source.path, kind: source.kind, meta, timescale, duration, samples };
}

// write order = presentation order across tracks (video first on ties)
function writeOrder(tracks: TrackPlan[]): { track: number; sample: number }[] {
  const pointers = tracks.map(() => 0);
  const order: { track: number; sample: number }[] = [];
  let remaining = tracks.reduce((acc, t) => acc + t.samples.length, 0);
  while (remaining > 0) {
    let pick = -1;
    let pickTs = Infinity;
    for (let t = 0; t < tracks.length; t++) {
      const s = pointers[t];
      if (s >= tracks[t].samples.length) continue;
      const ts = tracks[t].samples[s].ts;
      if (ts < pickTs || (ts === pickTs && pick === -1)) {
        pickTs = ts;
        pick = t;
      }
    }
    if (pick < 0) break;
    order.push({ track: pick, sample: pointers[pick]++ });
    remaining--;
  }
  return order;
}

export async function webmToMp4(
  io: MediaIO,
  sources: WebmSource[],
  outPath: string
): Promise<boolean> {
  try {
    const cache = new Map<string, WebmScan>();
    const tracks: TrackPlan[] = [];
    for (const source of sources) {
      const plan = await scanSource(io, source, cache);
      if (plan) tracks.push(plan);
    }
    if (tracks.length === 0) return false;

    const order = writeOrder(tracks);
    const ftyp = ftypBox();

    // stco placeholder offsets -> moov size -> real offsets (3 passes max)
    let offsets: number[][] = tracks.map((t) => t.samples.map(() => 0));
    let moov: Uint8Array = moovBox(tracks, offsets);
    const totalPayload = order.reduce((acc, o) => acc + tracks[o.track].samples[o.sample].size, 0);
    for (let pass = 0; pass < 3; pass++) {
      const mdatHeader = totalPayload >= 0xffffffff - 8 ? 16 : 8;
      let cursor = ftyp.length + moov.length + mdatHeader;
      const next: number[][] = tracks.map(() => []);
      for (const o of order) {
        next[o.track].push(cursor);
        cursor += tracks[o.track].samples[o.sample].size;
      }
      offsets = next;
      const rebuilt = moovBox(tracks, offsets);
      if (rebuilt.length === moov.length) {
        moov = rebuilt;
        break;
      }
      moov = rebuilt;
    }

    const total = ftyp.length + moov.length + (totalPayload >= 0xffffffff - 8 ? 16 : 8) + totalPayload;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await io.create(outPath);
      await io.create(outPath);
      let cursor = 0;
      await io.write(outPath, ftyp, 0);
      cursor += ftyp.length;
      await io.write(outPath, moov, cursor);
      cursor += moov.length;
      const mdatHeader = totalPayload >= 0xffffffff - 8 ? 16 : 8;
      const mdatBox = new Uint8Array(mdatHeader);
      const view = new DataView(mdatBox.buffer);
      if (mdatHeader === 16) {
        view.setUint32(0, 1);
        mdatBox.set([0x6d, 0x64, 0x61, 0x74], 4);
        view.setBigUint64(8, BigInt(totalPayload));
      } else {
        view.setUint32(0, totalPayload + 8);
        mdatBox.set([0x6d, 0x64, 0x61, 0x74], 4);
      }
      await io.write(outPath, mdatBox, cursor);
      cursor += mdatHeader;
      if (io.copyRanges) {
        // one native call per source; offsets[t] is push-ordered by the
        // order traversal, so mirror that with a per-track counter
        const seen = tracks.map(() => 0);
        const rangesByTrack: number[][] = tracks.map(() => []);
        for (const o of order) {
          const sample = tracks[o.track].samples[o.sample];
          rangesByTrack[o.track].push(
            offsets[o.track][seen[o.track]],
            sample.offset,
            sample.size
          );
          seen[o.track] += 1;
        }
        for (let t = 0; t < tracks.length; t++) {
          if (rangesByTrack[t].length > 0) {
            await io.copyRanges(tracks[t].path, outPath, rangesByTrack[t]);
          }
        }
      } else {
        for (const o of order) {
          const sample = tracks[o.track].samples[o.sample];
          const bytes = await io.read(tracks[o.track].path, sample.offset, sample.size);
          await io.write(outPath, bytes, cursor);
          cursor += sample.size;
        }
      }
      if ((await io.size(outPath)) === total) return true;
    }
    return false;
  } catch (err) {
    console.warn('webmToMp4 failed', err);
    return false;
  }
}
