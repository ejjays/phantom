const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b,
  0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0,
  0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26,
  0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2,
  0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0,
  0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed,
  0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f,
  0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5,
  0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec,
  0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14,
  0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c,
  0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d,
  0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f,
  0x4b, 0xbd, 0x8b, 0x8a, 0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e,
  0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
  0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f,
  0xb0, 0x54, 0xbb, 0x16,
]);

const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function xtime(value: number): number {
  return ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const B64ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64urlToBytes(input: string): Uint8Array {
  const std = input.replace(/-/gu, '+').replace(/_/gu, '/');
  const pad = std.length % 4 === 2 ? '==' : std.length % 4 === 3 ? '=' : '';
  const s = std + pad;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === '=') break;
    const val = B64ABC.indexOf(ch);
    if (val < 0) throw new Error('bad base64');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function expandKey256(key: Uint8Array): Uint32Array {
  const words = new Uint32Array(60);
  for (let i = 0; i < 8; i += 1) {
    words[i] =
      ((key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) >>> 0;
  }
  for (let i = 8; i < 60; i += 1) {
    let temp = words[i - 1];
    if (i % 8 === 0) {
      temp =
        ((SBOX[(temp >>> 16) & 0xff] << 24) |
          (SBOX[(temp >>> 8) & 0xff] << 16) |
          (SBOX[temp & 0xff] << 8) |
          SBOX[(temp >>> 24) & 0xff]) >>>
        0;
      temp ^= (RCON[i / 8 - 1] << 24) >>> 0;
    } else if (i % 8 === 4) {
      temp =
        ((SBOX[(temp >>> 24) & 0xff] << 24) |
          (SBOX[(temp >>> 16) & 0xff] << 16) |
          (SBOX[(temp >>> 8) & 0xff] << 8) |
          SBOX[temp & 0xff]) >>>
        0;
    }
    words[i] = (words[i - 8] ^ temp) >>> 0;
  }
  return words;
}

function encryptBlock(block: Uint8Array, words: Uint32Array): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 4; i += 1) {
    const word = words[i];
    s[i * 4] = (word >>> 24) & 0xff;
    s[i * 4 + 1] = (word >>> 16) & 0xff;
    s[i * 4 + 2] = (word >>> 8) & 0xff;
    s[i * 4 + 3] = word & 0xff;
    s[i * 4] ^= block[i * 4];
    s[i * 4 + 1] ^= block[i * 4 + 1];
    s[i * 4 + 2] ^= block[i * 4 + 2];
    s[i * 4 + 3] ^= block[i * 4 + 3];
  }
  for (let round = 1; round < 14; round += 1) {
    const t = new Uint8Array(16);
    t[0] = SBOX[s[0]]; t[4] = SBOX[s[4]]; t[8] = SBOX[s[8]]; t[12] = SBOX[s[12]];
    t[1] = SBOX[s[5]]; t[5] = SBOX[s[9]]; t[9] = SBOX[s[13]]; t[13] = SBOX[s[1]];
    t[2] = SBOX[s[10]]; t[6] = SBOX[s[14]]; t[10] = SBOX[s[2]]; t[14] = SBOX[s[6]];
    t[3] = SBOX[s[15]]; t[7] = SBOX[s[3]]; t[11] = SBOX[s[7]]; t[15] = SBOX[s[11]];
    if (round < 14) {
      for (let col = 0; col < 4; col += 1) {
        const a0 = t[col * 4];
        const a1 = t[col * 4 + 1];
        const a2 = t[col * 4 + 2];
        const a3 = t[col * 4 + 3];
        const x0 = xtime(a0);
        const x1 = xtime(a1);
        const x2 = xtime(a2);
        const x3 = xtime(a3);
        s[col * 4] = x0 ^ x1 ^ a1 ^ a2 ^ a3;
        s[col * 4 + 1] = a0 ^ x1 ^ x2 ^ a2 ^ a3;
        s[col * 4 + 2] = a0 ^ a1 ^ x2 ^ x3 ^ a3;
        s[col * 4 + 3] = x0 ^ a0 ^ a1 ^ a2 ^ x3;
      }
    } else {
      s.set(t);
    }
    for (let i = 0; i < 4; i += 1) {
      const word = words[round * 4 + i];
      s[i * 4] ^= (word >>> 24) & 0xff;
      s[i * 4 + 1] ^= (word >>> 16) & 0xff;
      s[i * 4 + 2] ^= (word >>> 8) & 0xff;
      s[i * 4 + 3] ^= word & 0xff;
    }
    if (round === 13) {
      const f = new Uint8Array(16);
      f[0] = SBOX[s[0]]; f[4] = SBOX[s[4]]; f[8] = SBOX[s[8]]; f[12] = SBOX[s[12]];
      f[1] = SBOX[s[5]]; f[5] = SBOX[s[9]]; f[9] = SBOX[s[13]]; f[13] = SBOX[s[1]];
      f[2] = SBOX[s[10]]; f[6] = SBOX[s[14]]; f[10] = SBOX[s[2]]; f[14] = SBOX[s[6]];
      f[3] = SBOX[s[15]]; f[7] = SBOX[s[3]]; f[11] = SBOX[s[7]]; f[15] = SBOX[s[11]];
      for (let i = 0; i < 4; i += 1) {
        const word = words[56 + i];
        f[i * 4] ^= (word >>> 24) & 0xff;
        f[i * 4 + 1] ^= (word >>> 16) & 0xff;
        f[i * 4 + 2] ^= (word >>> 8) & 0xff;
        f[i * 4 + 3] ^= word & 0xff;
      }
      return f;
    }
  }
  return s;
}

function gmul(left: Uint8Array, right: Uint8Array): Uint8Array {
  const acc = new Uint8Array(16);
  const vec = new Uint8Array(right);
  const poly = new Uint8Array([0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 16; i += 1) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((left[i] >> bit) & 1) {
        for (let k = 0; k < 16; k += 1) acc[k] ^= vec[k];
      }
      const lsb = vec[15] & 1;
      for (let k = 15; k > 0; k -= 1) {
        vec[k] = ((vec[k] >>> 1) | ((vec[k - 1] & 1) << 7)) & 0xff;
      }
      vec[0] >>>= 1;
      if (lsb) {
        for (let k = 0; k < 16; k += 1) vec[k] ^= poly[k];
      }
    }
  }
  return acc;
}

function ghash(authKey: Uint8Array, aad: Uint8Array, ct: Uint8Array): Uint8Array {
  let y: Uint8Array<ArrayBufferLike> = new Uint8Array(16);
  const xorBlock = (block: Uint8Array): void => {
    const mixed = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) mixed[i] = y[i] ^ (block[i] ?? 0);
    y = gmul(mixed, authKey);
  };
  for (let off = 0; off < aad.length; off += 16) {
    xorBlock(aad.slice(off, off + 16));
  }
  for (let off = 0; off < ct.length; off += 16) {
    xorBlock(ct.slice(off, off + 16));
  }
  const abit = aad.length * 8;
  const cbit = ct.length * 8;
  const full: number[] = [];
  const push32 = (value: number): void => {
    full.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  };
  push32(Math.floor(abit / 0x100000000));
  push32(abit >>> 0);
  push32(Math.floor(cbit / 0x100000000));
  push32(cbit >>> 0);
  xorBlock(new Uint8Array(full));
  return y;
}

function constEq(lhs: Uint8Array, rhs: Uint8Array): boolean {
  if (lhs.length !== rhs.length) return false;
  let diff = 0;
  for (let i = 0; i < lhs.length; i += 1) diff |= lhs[i] ^ rhs[i];
  return diff === 0;
}

function inc32(counter: Uint8Array): void {
  for (let i = 15; i >= 12; i -= 1) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) break;
  }
}

export function aes256GcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ct: Uint8Array,
  tag: Uint8Array
): Uint8Array {
  if (key.length !== 32) throw new Error('bad key');
  if (iv.length !== 12) throw new Error('bad iv');
  if (tag.length !== 16) throw new Error('bad tag');
  const words = expandKey256(key);
  const authHash = encryptBlock(new Uint8Array(16), words);
  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;
  const sum = ghash(authHash, new Uint8Array(0), ct);
  const mask = encryptBlock(j0, words);
  const expect = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) expect[i] = sum[i] ^ mask[i];
  if (!constEq(expect, tag)) throw new Error('auth fail');
  const out = new Uint8Array(ct.length);
  const ctr = new Uint8Array(j0);
  for (let off = 0; off < ct.length; off += 16) {
    inc32(ctr);
    const pad = encryptBlock(ctr, words);
    const count = Math.min(16, ct.length - off);
    for (let i = 0; i < count; i += 1) out[off + i] = ct[off + i] ^ pad[i];
  }
  return out;
}

export function decryptVidrockPayload(enc: string, keyHex: string): string {
  const raw = base64urlToBytes(enc);
  if (raw.length < 28) throw new Error('short payload');
  const iv = raw.slice(0, 12);
  const ctWithTag = raw.slice(12);
  const ct = ctWithTag.slice(0, ctWithTag.length - 16);
  const tag = ctWithTag.slice(ctWithTag.length - 16);
  const pt = aes256GcmDecrypt(hexToBytes(keyHex), iv, ct, tag);
  return utf8Decode(pt);
}

function utf8Decode(bytes: Uint8Array): string {
  const decoder = (globalThis as { TextDecoder?: new () => { decode(b: Uint8Array): string } }).TextDecoder;
  if (decoder) return new decoder().decode(bytes);
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else {
      out += '?';
      i += 1;
    }
  }
  return out;
}
