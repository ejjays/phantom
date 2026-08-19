import { open, rm, stat } from 'node:fs/promises';
import type { MediaIO } from '../../src/lib/media/io';

export const nodeIo: MediaIO = {
  async size(path) {
    return (await stat(path)).size;
  },
  async read(path, offset, length) {
    const handle = await open(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, offset);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  },
  async write(path, bytes, offset) {
    const handle = await open(path, 'r+');
    try {
      await handle.write(bytes, 0, bytes.length, offset);
    } finally {
      await handle.close();
    }
  },
  async create(path) {
    const handle = await open(path, 'w');
    await handle.close();
  },
  async delete(path) {
    await rm(path, { force: true });
  },
};