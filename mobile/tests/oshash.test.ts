import { describe, it, expect } from 'vitest';

import { oshash } from '../src/lib/oshash';

const zeros = (count: number): Uint8Array => new Uint8Array(count);

describe('oshash', () => {
  it('is a 16-char lowercase hex string', () => {
    expect(oshash(zeros(65536), zeros(65536), 700000000)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    const headFill = new Uint8Array(65536).fill(7);
    const tailFill = new Uint8Array(65536).fill(9);
    expect(oshash(headFill, tailFill, 123)).toBe(oshash(headFill, tailFill, 123));
  });

  it('changes with input bytes and size', () => {
    const headFill = new Uint8Array(65536).fill(7);
    const tailFill = new Uint8Array(65536).fill(9);
    const base = oshash(headFill, tailFill, 123);
    const headAlt = new Uint8Array(65536).fill(7);
    headAlt[65535] = 6;
    expect(oshash(headAlt, tailFill, 123)).not.toBe(base);
    expect(oshash(headFill, tailFill, 124)).not.toBe(base);
  });

  it('matches the reference vector', () => {
    const head = new Uint8Array(65536);
    const tail = new Uint8Array(65536);
    head[0] = 1;
    tail[65535] = 2;
    expect(oshash(head, tail, 131072)).toBe('0200000000020001');
  });
});
