import { File, FileMode } from 'expo-file-system';

// incremental sha256 (hermes has no node:crypto); feed whole buffers, then finalize
const ROTR = (x: number, shift: number): number => (x >>> shift) | (x << (32 - shift));
const ROUND_KEYS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SIG0 = (x: number): number => ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22);
const SIG1 = (x: number): number => ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25);
const LOWER0 = (x: number): number => ROTR(x, 7) ^ ROTR(x, 18) ^ (x >>> 3);
const LOWER1 = (x: number): number => ROTR(x, 17) ^ ROTR(x, 19) ^ (x >>> 10);

export class Sha256 {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private used = 0;
  private length = 0;

  update(data: Uint8Array): this {
    this.length += data.length;
    let pos = 0;
    if (this.used > 0) {
      const take = Math.min(64 - this.used, data.length);
      this.block.set(data.subarray(0, take), this.used);
      this.used += take;
      pos += take;
      if (this.used === 64) {
        this.compress(this.block);
        this.used = 0;
      }
    }
    while (pos + 64 <= data.length) {
      this.compress(data.subarray(pos, pos + 64));
      pos += 64;
    }
    if (pos < data.length) {
      this.block.set(data.subarray(pos));
      this.used = data.length - pos;
    }
    return this;
  }

  finalize(): string {
    const bits = this.length * 8;
    this.update(new Uint8Array([0x80]));
    while (this.used !== 56) this.update(new Uint8Array([0]));
    const len = new DataView(new ArrayBuffer(8));
    len.setUint32(0, Math.floor(bits / 0x100000000));
    len.setUint32(4, bits >>> 0);
    this.update(new Uint8Array(len.buffer));
    return [...this.state].map((word) => word.toString(16).padStart(8, '0')).join('');
  }

  private compress(block: Uint8Array): void {
    const words = new Uint32Array(64);
    const dv = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) words[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++)
      words[i] =
        (LOWER1(words[i - 2]) + words[i - 7] + LOWER0(words[i - 15]) + words[i - 16]) >>>
        0;
    let [v0, v1, v2, v3, v4, v5, v6, v7] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (v7 + SIG1(v4) + ((v4 & v5) ^ (~v4 & v6)) + ROUND_KEYS[i] + words[i]) >>>
        0;
      const t2 = (SIG0(v0) + ((v0 & v1) ^ (v0 & v2) ^ (v1 & v2))) >>> 0;
      v7 = v6;
      v6 = v5;
      v5 = v4;
      v4 = (v3 + t1) >>> 0;
      v3 = v2;
      v2 = v1;
      v1 = v0;
      v0 = (t1 + t2) >>> 0;
    }
    const round = [v0, v1, v2, v3, v4, v5, v6, v7];
    for (let i = 0; i < 8; i++) this.state[i] = (this.state[i] + round[i]) >>> 0;
  }
}

const SLICE = 4_000_000;

export function sha256Hex(file: File): string {
  const handle = file.open(FileMode.ReadOnly);
  const hash = new Sha256();
  try {
    let remaining = file.size;
    handle.offset = 0;
    while (remaining > 0) {
      const bytes = handle.readBytes(Math.min(SLICE, remaining));
      if (bytes.byteLength === 0) break;
      hash.update(bytes);
      remaining -= bytes.byteLength;
    }
  } finally {
    handle.close();
  }
  return hash.finalize();
}