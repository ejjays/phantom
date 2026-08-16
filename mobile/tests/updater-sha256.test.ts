import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from '../src/lib/updater/sha256';

const nodeHash = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

function hashInPieces(bytes: Uint8Array, piece: number): string {
  const hash = new Sha256();
  for (let i = 0; i < bytes.length; i += piece) {
    hash.update(bytes.subarray(i, Math.min(i + piece, bytes.length)));
  }
  return hash.finalize();
}

describe('Sha256', () => {
  it('matches known vectors', () => {
    const empty = new Sha256();
    expect(empty.finalize()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    const abc = new Sha256().update(new TextEncoder().encode('abc'));
    expect(abc.finalize()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it.each([0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 65_537])(
    'matches node:crypto for %s random bytes',
    (size) => {
      const bytes = randomBytes(size);
      expect(hashInPieces(bytes, 7)).toBe(nodeHash(bytes));
      expect(hashInPieces(bytes, 64)).toBe(nodeHash(bytes));
      expect(hashInPieces(bytes, 64_001)).toBe(nodeHash(bytes));
    }
  );

  it('matches node:crypto for a large multi-slice buffer', () => {
    const bytes = randomBytes(2_500_000);
    expect(hashInPieces(bytes, 4_000_000)).toBe(nodeHash(bytes));
  });

  it('is order-dependent', () => {
    const first = new Sha256().update(new TextEncoder().encode('ab'));
    first.update(new TextEncoder().encode('c'));
    const second = new Sha256().update(new TextEncoder().encode('abc'));
    expect(first.finalize()).toBe(second.finalize());
  });
});