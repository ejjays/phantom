const HASH_CHUNK = 65536;

function sumWords(data: Uint8Array, hash: bigint): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const words = Math.floor(data.byteLength / 8);
  let total = hash;
  for (let i = 0; i < words; i += 1) {
    total += view.getBigUint64(i * 8, true);
  }
  return total;
}

export function oshash(
  head: Uint8Array,
  tail: Uint8Array,
  fileSize: number
): string {
  let hash = BigInt(Math.max(0, Math.floor(fileSize)));
  hash = sumWords(head.slice(0, HASH_CHUNK), hash);
  hash = sumWords(tail.slice(-HASH_CHUNK), hash);
  return (hash & 0xffffffffffffffffn).toString(16).padStart(16, '0');
}
