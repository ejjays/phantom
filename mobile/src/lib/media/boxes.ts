// canonical byte-level helpers for mp4 container work (spec: ISO/IEC 14496-12)

export function be16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff);
  return out;
}

export function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

export function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

export function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(be32(8 + payload.length), ascii(type), payload);
}

// for 4cc ids that aren't pure ascii (©nam etc are latin-1 0xa9 + ascii)
export function boxRaw(type: Uint8Array, payload: Uint8Array): Uint8Array {
  return concat(be32(8 + payload.length), type, payload);
}

export function emptyBox(type: string): Uint8Array {
  return box(type, new Uint8Array(0));
}

export function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
}

export function u64(bytes: Uint8Array, offset: number): number {
  return Number(new DataView(bytes.buffer, bytes.byteOffset + offset).getBigUint64(0));
}

export function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

const IDENTITY_MATRIX = new Uint8Array(36);
(() => {
  const view = new DataView(IDENTITY_MATRIX.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(16, 0x00010000);
  view.setUint32(32, 0x40000000);
})();

// movie header (v0): timescale drives timestamps, duration in that timescale
export function mvhd(
  timescale: number,
  duration: number,
  nextTrackId: number
): Uint8Array {
  return box(
    'mvhd',
    concat(
      be32(0),
      be32(0),
      be32(0),
      be32(timescale),
      be32(duration),
      be32(0x00010000),
      be16(0x0100),
      be16(0),
      new Uint8Array(8),
      IDENTITY_MATRIX,
      be32(0),
      be32(0),
      be32(0),
      be32(0),
      be32(0),
      be32(0),
      be32(nextTrackId)
    )
  );
}