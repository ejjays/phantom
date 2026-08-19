// minimal ebml (matroska/webm) element reader on MediaIO — enough to walk a
// webm's segment/tracks/clusters without buffering media bytes.

import type { MediaIO } from '../io';

export interface Elem {
  id: number;
  dataOffset: number;
  size: number;
}

export const EBML_ID = 0x1a45dfa3;
export const SEGMENT_ID = 0x18538067;
export const INFO_ID = 0x1549a966;
export const TRACKS_ID = 0x1654ae6b;
export const CLUSTER_ID = 0x1f43b675;
export const TRACK_ENTRY_ID = 0xae;
export const TRACK_NUMBER_ID = 0xd7;
export const TRACK_TYPE_ID = 0x83;
export const CODEC_ID_ID = 0x86;
export const CODEC_PRIVATE_ID = 0x63a2;
export const DEFAULT_DURATION_ID = 0x23e383;
export const VIDEO_ID = 0xe0;
export const AUDIO_ID = 0xe1;
export const PIXEL_WIDTH_ID = 0xb0;
export const PIXEL_HEIGHT_ID = 0xba;
export const SAMPLING_FREQ_ID = 0xb5;
export const CHANNELS_ID = 0x9f;
export const TIMESTAMP_SCALE_ID = 0x2ad7b1;
export const DURATION_ID = 0x4489;
export const CLUSTER_TIMECODE_ID = 0xe7;
export const SIMPLE_BLOCK_ID = 0xa3;
export const BLOCK_GROUP_ID = 0xa0;
export const BLOCK_ID = 0xa1;

// ebml vint length: leading-ones bits of the first byte
export function vintLen(first: number): number {
  let len = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && len < 8) {
    mask >>= 1;
    len++;
  }
  return len;
}

// size vint: marker bit excluded from the value (all-ones = unknown size)
export function vintValue(bytes: Uint8Array, offset: number, len: number): number {
  let value = bytes[offset] & (0xff >>> len);
  for (let i = 1; i < len; i++) value = value * 256 + bytes[offset + i];
  return value;
}

// element id vint: id bytes are opaque, no marker stripping
export function vintId(bytes: Uint8Array, offset: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i++) value = value * 256 + bytes[offset + i];
  return value;
}

export async function readElem(
  io: MediaIO,
  path: string,
  offset: number,
  limit: number
): Promise<Elem | null> {
  if (offset + 1 > limit) return null;
  const head = await io.read(path, offset, Math.min(17, limit - offset));
  if (head.length < 1) return null;
  const idLen = vintLen(head[0]);
  const id = vintId(head, 0, idLen);
  if (head.length <= idLen) return null;
  const sizeLen = vintLen(head[idLen]);
  if (head.length < idLen + sizeLen) return null;
  const rawSize = vintValue(head, idLen, sizeLen);
  const headerSize = idLen + sizeLen;
  // all-ones size = runs to end of parent
  const size =
    rawSize === (1 << (7 * sizeLen)) - 1
      ? Math.max(0, limit - offset - headerSize)
      : rawSize;
  return { id, dataOffset: offset + headerSize, size };
}

// big-endian ebml uint (plain BE — marker-bit stripping applies to vints only)
export function ebmlUint(bytes: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < bytes.length; i++) value = value * 256 + bytes[i];
  return value;
}

export function ebmlFloat(bytes: Uint8Array): number {
  if (bytes.length === 8) {
    return Number(new DataView(bytes.buffer, bytes.byteOffset).getFloat64(0));
  }
  return new DataView(bytes.buffer, bytes.byteOffset).getFloat32(0);
}

export function i16be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset).getInt16(0);
}
