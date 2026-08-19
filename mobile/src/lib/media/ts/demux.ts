import { ascii, be16, be32, box, concat } from '../boxes';
import type { MediaIO } from '../io';
import { error as logError } from '../../log';
import { aacEsds } from '../mp4/fragments';

// mpeg-ts (hls mpegts segments) -> m4a, aac (adts) audio only.
// video or unknown streams -> null (caller falls back to ffmpeg).

const TS_PACKET = 188;
const SYNC = 0x47;
const PAT_PID = 0;
const AAC_STREAM = 0x0f;
const H264_STREAM = 0x1b;
const HEVC_STREAM = 0x24;
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export interface AdtsInfo {
  sampleRate: number;
  channels: number;
  objectType: number;
}

export interface AdtsFrame {
  offset: number;
  length: number;
}

interface TsState {
  patPid: number | null;
  pmtPid: number | null;
  audioPid: number | null;
  videoSeen: boolean;
  otherSeen: boolean;
}

function parseSection(data: Uint8Array, start: number): Uint8Array | null {
  if (start + 2 > data.length || data[start] !== 0) return null;
  // pointer field 0: section starts at the next byte
  const sectionStart = start + 1;
  if (sectionStart + 3 > data.length) return null;
  const len = ((data[sectionStart + 1] & 0x0f) << 8) | data[sectionStart + 2];
  if (sectionStart + 3 + len > data.length) return null;
  return data.subarray(sectionStart, sectionStart + 3 + len);
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
    const type = section[pos];
    const pid = ((section[pos + 1] & 0x1f) << 8) | section[pos + 2];
    const esLen = ((section[pos + 3] & 0x0f) << 8) | section[pos + 4];
    streams.push({ type, pid });
    pos += 5 + esLen;
  }
  return streams;
}

function pesPayload(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 9) return null;
  if (payload[0] !== 0 || payload[1] !== 0 || payload[2] !== 1) return null;
  const headerLen = payload[8];
  if (payload.length < 9 + headerLen) return null;
  return payload.subarray(9 + headerLen);
}

function adtsHeader(data: Uint8Array, i: number): { len: number; header: number; freqIdx: number; chanCfg: number; profile: number } | null {
  if (data[i] !== 0xff || (data[i + 1] & 0xf0) !== 0xf0) return null;
  const protectionAbsent = (data[i + 1] & 0x01) !== 0;
  const len = ((data[i + 3] & 0x03) << 11) | (data[i + 4] << 3) | ((data[i + 5] >> 5) & 0x07);
  const header = 7 + (protectionAbsent ? 0 : 2);
  if (len < header) return null;
  return {
    len,
    header,
    profile: (data[i + 2] >> 6) & 0x03,
    freqIdx: (data[i + 2] >> 2) & 0x0f,
    chanCfg: ((data[i + 2] & 0x01) << 2) | ((data[i + 3] >> 6) & 0x03),
  };
}

interface RunScan {
  info: AdtsInfo | null;
  totalBytes: number;
}

// scan a run of pes payload bytes (contiguous in file, starting at absBase).
// frames are contiguous within a run; a frame may not span pes boundaries.
function scanRun(run: Uint8Array, absBase: number, state: RunScan, onFrame: (offset: number, length: number) => void): void {
  let i = 0;
  while (i + 7 <= run.length) {
    const hdr = adtsHeader(run, i);
    if (hdr === null) {
      i += 1;
      continue;
    }
    if (state.info !== null && state.info.sampleRate !== RATES[hdr.freqIdx]) {
      i += 1;
      continue;
    }
    if (state.info === null) {
      if (hdr.freqIdx >= RATES.length) return;
      state.info = { sampleRate: RATES[hdr.freqIdx], channels: hdr.chanCfg, objectType: hdr.profile + 1 };
    }
    if (i + hdr.len > run.length) return;
    onFrame(absBase + i + hdr.header, hdr.len - hdr.header);
    i += hdr.len;
  }
}

// scan one chunk of the ts file (must be aligned to packet boundaries).
// returns the aac frames found in this chunk with file-absolute offsets.
export function demuxChunk(bytes: Uint8Array, absStart: number, state: TsState): { frames: AdtsFrame[]; info: AdtsInfo | null } {
  const frames: AdtsFrame[] = [];
  const scan: RunScan = { info: null, totalBytes: 0 };
  let run: number[] | null = null;
  let runAbs = -1;

  const finishRun = (): void => {
    if (run === null) return;
    scanRun(Uint8Array.from(run), runAbs, scan, (offset, length) => frames.push({ offset, length }));
    run = null;
  };

  let pos = 0;
  while (pos + TS_PACKET <= bytes.length) {
    if (bytes[pos] !== SYNC) {
      pos += 1;
      continue;
    }
    const pkt = bytes.subarray(pos, pos + TS_PACKET);
    const tei = (pkt[1] & 0x80) !== 0;
    const pusi = (pkt[1] & 0x40) !== 0;
    const pid = ((pkt[1] & 0x1f) << 8) | pkt[2];
    if (!tei && (pkt[3] & 0x10) !== 0) {
      let payloadStart = 4;
      if ((pkt[3] & 0x20) !== 0) {
        const afl = pkt[4];
        payloadStart = 5 + afl;
        if (payloadStart > TS_PACKET) payloadStart = TS_PACKET;
      }
      if (payloadStart < TS_PACKET) {
        const payload = pkt.subarray(payloadStart, TS_PACKET);
        if (pid === PAT_PID && pusi) {
          const section = parseSection(payload, 0);
          if (section) {
            const pmt = patPmtPid(section);
            if (pmt !== null) state.patPid = pmt;
          }
        } else if (pid === state.patPid && pusi) {
          const section = parseSection(payload, 0);
          if (section) {
            for (const s of pmtStreams(section)) {
              if (s.type === AAC_STREAM) state.audioPid ??= s.pid;
              else if (s.type === H264_STREAM || s.type === HEVC_STREAM) state.videoSeen = true;
              else state.otherSeen = true;
            }
          }
        } else if (pid === state.audioPid) {
          if (pusi) finishRun();
          const body = pusi ? pesPayload(payload) : payload;
          if (body !== null && body.length > 0) {
            if (run === null) runAbs = pos + payloadStart + (pusi ? payload.length - body.length : 0);
            run ??= [];
            run.push(...body);
          } else if (pusi && run !== null) {
            finishRun();
          }
        }
      }
    }
    pos += TS_PACKET;
  }
  finishRun();
  return { frames, info: scan.info };
}

// build m4a from a ts file with adts aac. returns false when the ts has video,
// unknown streams, no aac, or no frames.
export async function demuxTsToM4a(io: MediaIO, srcPath: string, outPath: string): Promise<boolean> {
  const size = await io.size(srcPath);
  if (size < TS_PACKET) return false;
  const head = await io.read(srcPath, 0, TS_PACKET);
  if (head[0] !== SYNC) return false;

  const state: TsState = { patPid: null, pmtPid: null, audioPid: null, videoSeen: false, otherSeen: false };
  const frames: AdtsFrame[] = [];
  let info: AdtsInfo | null = null;
  const CHUNK = TS_PACKET * 5577;
  let offset = 0;
  while (offset < size) {
    const len = Math.min(CHUNK, size - offset);
    const bytes = await io.read(srcPath, offset, len);
    const chunk = demuxChunk(bytes, offset, state);
    if (chunk.info !== null) info = chunk.info;
    frames.push(...chunk.frames);
    offset += len;
  }
  if (state.videoSeen || state.otherSeen || info === null || frames.length === 0) {
    logError('core', `demux refused: video=${state.videoSeen} other=${state.otherSeen} aac=${info !== null} frames=${frames.length}`);
    return false;
  }

  const trackId = 1;
  const timescale = info.sampleRate;
  const duration = frames.length * 1024;
  const freqIdx = RATES.indexOf(timescale);
  if (freqIdx < 0) return false;
  const asc = new Uint8Array(2);
  asc[0] = ((info.objectType << 3) & 0xf8) | ((freqIdx >> 1) & 0x07);
  asc[1] = ((freqIdx & 0x01) << 7) | ((info.channels & 0x0f) << 3);

  const mp4a = concat(
    new Uint8Array(6),
    be16(1),
    be16(0),
    be16(0),
    new Uint8Array(4),
    be16(info.channels),
    be16(16),
    be16(0),
    be16(0),
    be32(timescale << 16),
    aacEsds(asc)
  );
  const stsd = box('stsd', concat(be32(0), be32(1), box('mp4a', mp4a)));
  const stts = box('stts', concat(be32(0), be32(1), be32(frames.length), be32(1024)));
  const stsc = box('stsc', concat(be32(0), be32(1), be32(1), be32(1), be32(1)));
  const stsz = box('stsz', concat(be32(0), be32(0), be32(frames.length), ...frames.map((f) => be32(f.length))));
  const tkhd = box('tkhd', concat(be32(7), be32(0), be32(0), be32(trackId), be32(0), be32(duration), new Uint8Array(8), be16(0), be16(0), be16(0x0100), new Uint8Array(2), new Uint8Array(36), be32(0), be32(0)));
  const mvhd = box('mvhd', concat(be32(0), be32(0), be32(0), be32(timescale), be32(duration), be32(0x00010000), be16(0x0100), be16(0), new Uint8Array(8), new Uint8Array(36), new Uint8Array(24), be32(trackId + 1)));

  const buildMoov = (chunkOffset: number): Uint8Array => {
    const stcoFinal = box('stco', concat(be32(0), be32(1), be32(chunkOffset)));
    const stblFinal = box('stbl', concat(stsd, stts, stsc, stsz, stcoFinal));
    const minfFinal = box('minf', concat(box('smhd', be32(0)), box('dinf', box('dref', concat(be32(0), be32(1), box('url ', be32(1))))), stblFinal));
    const mdiaFinal = box('mdia', concat(box('mdhd', concat(be32(0), be32(0), be32(0), be32(timescale), be32(duration), be16(0x55c4), be16(0))), box('hdlr', concat(be32(0), be32(0), be32(0x736f756e), new Uint8Array(12), new Uint8Array(1))), minfFinal));
    const trakFinal = box('trak', concat(tkhd, mdiaFinal));
    return box('moov', concat(mvhd, trakFinal));
  };

  const ftyp = box('ftyp', concat(ascii('M4A '), be32(0), ascii('M4A '), ascii('mp42'), ascii('isom')));
  const moov = buildMoov(0);
  const dataStart = ftyp.length + moov.length + 8;
  const moovFinal = buildMoov(dataStart);
  const totalBytes = frames.reduce((sum, f) => sum + f.length, 0);
  const mdatHeader = new Uint8Array(8);
  new DataView(mdatHeader.buffer).setUint32(0, totalBytes + 8);
  mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);

  await io.create(outPath);
  let cursor = 0;
  await io.write(outPath, ftyp, cursor);
  cursor += ftyp.length;
  await io.write(outPath, moovFinal, cursor);
  cursor += moovFinal.length;
  await io.write(outPath, mdatHeader, cursor);
  cursor += 8;
  for (const frame of frames) {
    const bytes = await io.read(srcPath, frame.offset, frame.length);
    await io.write(outPath, bytes, cursor);
    cursor += bytes.length;
  }
  return true;
}
