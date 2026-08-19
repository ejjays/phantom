// webm demux — one scan pass builds track meta + a frame table (offset/size/
// ts only, never media bytes), a second pass streams payloads from disk.

import type { MediaIO } from '../io';
import {
  AUDIO_ID,
  BLOCK_GROUP_ID,
  BLOCK_ID,
  CHANNELS_ID,
  CLUSTER_ID,
  CLUSTER_TIMECODE_ID,
  CODEC_ID_ID,
  CODEC_PRIVATE_ID,
  DEFAULT_DURATION_ID,
  DURATION_ID,
  EBML_ID,
  ebmlFloat,
  ebmlUint,
  i16be,
  INFO_ID,
  PIXEL_HEIGHT_ID,
  PIXEL_WIDTH_ID,
  readElem,
  SAMPLING_FREQ_ID,
  SEGMENT_ID,
  SIMPLE_BLOCK_ID,
  TIMESTAMP_SCALE_ID,
  TRACK_ENTRY_ID,
  TRACK_NUMBER_ID,
  TRACKS_ID,
  TRACK_TYPE_ID,
  VIDEO_ID,
  vintLen,
  vintValue,
} from './ebml';

export interface WebmFrame {
  track: number;
  ts: number;
  key: boolean;
  offset: number;
  size: number;
}

export interface WebmTrack {
  number: number;
  kind: 'video' | 'audio';
  codec: string;
  codecPrivate: Uint8Array | null;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
  defaultDuration: number;
}

export interface WebmScan {
  scale: number;
  duration: number;
  tracks: WebmTrack[];
  frames: WebmFrame[];
}

export async function isWebm(io: MediaIO, path: string): Promise<boolean> {
  const head = await io.read(path, 0, 4);
  if (head.length < 4) return false;
  return (
    head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
  );
}

// block payload parse: [track vint][i16 rel tc][flags][data]
function blockInfo(
  bytes: Uint8Array,
  simple: boolean
): { track: number; rel: number; key: boolean; flags: number; headerLen: number } | null {
  if (bytes.length < 4) return null;
  const trackLen = vintLen(bytes[0]);
  if (bytes.length < trackLen + 2 + (simple ? 1 : 0)) return null;
  const track = vintValue(bytes, 0, trackLen);
  const rel = i16be(bytes, trackLen);
  const flags = simple ? bytes[trackLen + 2] : 0;
  const key = simple ? (flags & 0x80) !== 0 : false;
  return { track, rel, key, flags, headerLen: trackLen + 2 + (simple ? 1 : 0) };
}

export async function scanWebm(
  io: MediaIO,
  path: string,
  fileSize: number
): Promise<WebmScan | null> {
  if (!(await isWebm(io, path))) return null;

  let scale = 1000000;
  let duration = 0;
  const tracks = new Map<number, WebmTrack>();
  const frames: WebmFrame[] = [];

  const parseTrack = async (elem: { dataOffset: number; size: number }): Promise<void> => {
    const bytes = await io.read(path, elem.dataOffset, Math.min(elem.size, 512));
    let off = 0;
    const track: WebmTrack = {
      number: 0,
      kind: 'video',
      codec: '',
      codecPrivate: null,
      width: 0,
      height: 0,
      sampleRate: 48000,
      channels: 2,
      defaultDuration: 0,
    };
    while (off + 1 < bytes.length) {
      const idLen = vintLen(bytes[off]);
      const id = (() => {
        let v = 0;
        for (let i = 0; i < idLen; i++) v = v * 256 + bytes[off + i];
        return v;
      })();
      if (off + idLen >= bytes.length) break;
      const sizeLen = vintLen(bytes[off + idLen]);
      if (off + idLen + sizeLen > bytes.length) break;
      const size = vintValue(bytes, off + idLen, sizeLen);
      const data = off + idLen + sizeLen;
      const end = Math.min(data + size, bytes.length);
      switch (id) {
        case TRACK_NUMBER_ID:
          track.number = ebmlUint(bytes.subarray(data, end));
          break;
        case TRACK_TYPE_ID:
          track.kind = ebmlUint(bytes.subarray(data, end)) === 1 ? 'video' : 'audio';
          break;
        case CODEC_ID_ID: {
          const s = bytes.subarray(data, end);
          track.codec = String.fromCharCode(...s);
          break;
        }
        case CODEC_PRIVATE_ID:
          track.codecPrivate = bytes.slice(data, end);
          break;
        case DEFAULT_DURATION_ID:
          track.defaultDuration = ebmlUint(bytes.subarray(data, end));
          break;
        case VIDEO_ID: {
          let voff = data;
          while (voff + 1 < end) {
            const vidLen = vintLen(bytes[voff]);
            const vid = (() => {
              let v = 0;
              for (let i = 0; i < vidLen; i++) v = v * 256 + bytes[voff + i];
              return v;
            })();
            if (voff + vidLen >= end) break;
            const vsLen = vintLen(bytes[voff + vidLen]);
            if (voff + vidLen + vsLen > end) break;
            const vsz = vintValue(bytes, voff + vidLen, vsLen);
            const vd = voff + vidLen + vsLen;
            const vend = Math.min(vd + vsz, end);
            if (vid === PIXEL_WIDTH_ID) track.width = ebmlUint(bytes.subarray(vd, vend));
            if (vid === PIXEL_HEIGHT_ID) track.height = ebmlUint(bytes.subarray(vd, vend));
            voff = vd + vsz;
          }
          break;
        }
        case AUDIO_ID: {
          let aoff = data;
          while (aoff + 1 < end) {
            const aidLen = vintLen(bytes[aoff]);
            const aid = (() => {
              let v = 0;
              for (let i = 0; i < aidLen; i++) v = v * 256 + bytes[aoff + i];
              return v;
            })();
            if (aoff + aidLen >= end) break;
            const asLen = vintLen(bytes[aoff + aidLen]);
            if (aoff + aidLen + asLen > end) break;
            const asz = vintValue(bytes, aoff + aidLen, asLen);
            const ad = aoff + aidLen + asLen;
            const aend = Math.min(ad + asz, end);
            if (aid === SAMPLING_FREQ_ID) track.sampleRate = Math.round(ebmlFloat(bytes.subarray(ad, aend)));
            if (aid === CHANNELS_ID) track.channels = ebmlUint(bytes.subarray(ad, aend));
            aoff = ad + asz;
          }
          break;
        }
      }
      off = data + size;
    }
    if (track.number > 0 && (track.codec === 'V_VP9' || track.codec === 'A_OPUS')) {
      tracks.set(track.number, track);
    }
  };

  const parseCluster = async (elem: { dataOffset: number; size: number }): Promise<void> => {
    let off = elem.dataOffset;
    const limit = elem.dataOffset + elem.size;
    let clusterTc = 0;
    while (off < limit) {
      const child = await readElem(io, path, off, limit);
      if (!child) break;
      off = child.dataOffset + child.size;
      if (child.id === CLUSTER_TIMECODE_ID) {
        const bytes = await io.read(path, child.dataOffset, Math.min(child.size, 8));
        clusterTc = ebmlUint(bytes);
        continue;
      }
      if (child.id === SIMPLE_BLOCK_ID || child.id === BLOCK_ID) {
        const simple = child.id === SIMPLE_BLOCK_ID;
        if (simple && child.size <= 0) continue;
        const head = await io.read(path, child.dataOffset, Math.min(child.size, 16));
        const info = blockInfo(head, simple);
        // laced blocks (flags & 0x06) split one payload into many frames —
        // youtube never laces, refuse rather than mis-chunk
        if (!info || (info.flags & 0x06) !== 0) continue;
        frames.push({
          track: info.track,
          ts: clusterTc + info.rel,
          key: info.key,
          offset: child.dataOffset + info.headerLen,
          size: child.size - info.headerLen,
        });
        continue;
      }
      if (child.id === BLOCK_GROUP_ID) {
        const gbytes = await io.read(path, child.dataOffset, Math.min(child.size, 32));
        if (gbytes.length < 4) continue;
        const gidLen = vintLen(gbytes[0]);
        if (vintLen(gbytes[gidLen]) > gbytes.length - gidLen) continue;
        if ((() => {
          let v = 0;
          for (let i = 0; i < gidLen; i++) v = v * 256 + gbytes[i];
          return v;
        })() !== BLOCK_ID) continue;
        const bsizeLen = vintLen(gbytes[gidLen]);
        const bsize = vintValue(gbytes, gidLen, bsizeLen);
        const bdata = child.dataOffset + gidLen + bsizeLen;
        const head = await io.read(path, bdata, Math.min(bsize, 16));
        const info = blockInfo(head, false);
        if (!info) continue;
        frames.push({
          track: info.track,
          ts: clusterTc + info.rel,
          key: false,
          offset: bdata + info.headerLen,
          size: bsize - info.headerLen,
        });
      }
    }
  };

  try {
    let offset = 0;
    const header = await readElem(io, path, 0, fileSize);
    if (!header || header.id !== EBML_ID) return null;
    offset = header.dataOffset + header.size;
    while (offset < fileSize) {
      const elem = await readElem(io, path, offset, fileSize);
      if (!elem) break;
      if (elem.id === SEGMENT_ID) {
        let segOff = elem.dataOffset;
        const segLimit = elem.dataOffset + elem.size;
        while (segOff < segLimit) {
          const child = await readElem(io, path, segOff, segLimit);
          if (!child) break;
          segOff = child.dataOffset + child.size;
          if (child.id === INFO_ID) {
            const bytes = await io.read(path, child.dataOffset, Math.min(child.size, 128));
            let off = 0;
            while (off + 1 < bytes.length) {
              const idLen = vintLen(bytes[off]);
              const id = (() => {
                let v = 0;
                for (let i = 0; i < idLen; i++) v = v * 256 + bytes[off + i];
                return v;
              })();
              if (off + idLen >= bytes.length) break;
              const sizeLen = vintLen(bytes[off + idLen]);
              if (off + idLen + sizeLen > bytes.length) break;
              const size = vintValue(bytes, off + idLen, sizeLen);
              const data = off + idLen + sizeLen;
              const end = Math.min(data + size, bytes.length);
              if (id === TIMESTAMP_SCALE_ID) scale = ebmlUint(bytes.subarray(data, end));
              if (id === DURATION_ID) duration = ebmlFloat(bytes.subarray(data, end));
              off = data + size;
            }
          } else if (child.id === TRACKS_ID) {
            let off = child.dataOffset;
            const limit = child.dataOffset + child.size;
            while (off < limit) {
              const entry = await readElem(io, path, off, limit);
              if (!entry) break;
              off = entry.dataOffset + entry.size;
              if (entry.id === TRACK_ENTRY_ID) {
                const sub = { dataOffset: entry.dataOffset, size: entry.size };
                await parseTrack(sub);
              }
            }
          } else if (child.id === CLUSTER_ID) {
            const cluster = { dataOffset: child.dataOffset, size: child.size };
            await parseCluster(cluster);
          }
        }
        break;
      }
      offset = elem.dataOffset + elem.size;
    }
  } catch (err) {
    console.warn('webm scan failed', err);
    return null;
  }

  const trackList = [...tracks.values()];
  const valid = trackList.map((t) => t.number);
  return {
    scale,
    duration,
    tracks: trackList,
    frames: frames.filter((f) => valid.includes(f.track)),
  };
}
