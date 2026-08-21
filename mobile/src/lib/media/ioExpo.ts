import { File, FileMode } from 'expo-file-system';
import type { MediaIO } from './io';
import { copyRanges as nativeCopyRanges } from '../../../modules/mediacopy';

// expo File api accepts file:// uris; the native mover needs raw paths
function fsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

// container parsers walk structures with thousands of tiny reads; serve them
// from a per-path window so one bridge call covers hundreds of reads
const WINDOW = 1 << 20;
const windows = new Map<string, { start: number; bytes: Uint8Array }>();

function dropWindow(path: string): void {
  windows.delete(path);
}

function readThrough(
  path: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const win = windows.get(path);
  if (
    win &&
    offset >= win.start &&
    offset + length <= win.start + win.bytes.length
  ) {
    return Promise.resolve(
      win.bytes.slice(offset - win.start, offset - win.start + length)
    );
  }
  const handle = new File(path).open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    if (length >= WINDOW || offset + length > size) {
      handle.offset = offset;
      return Promise.resolve(handle.readBytes(length));
    }
    handle.offset = offset;
    const bytes = handle.readBytes(Math.min(WINDOW, size - offset));
    if (windows.size > 8) windows.clear();
    windows.set(path, { start: offset, bytes });
    return Promise.resolve(bytes.slice(0, length));
  } finally {
    handle.close();
  }
}

// expo FileHandle-backed io — handle per call, sequential chunk access.
// reads/writes never exceed a chunk, so no full-file RAM use.
export const expoIo: MediaIO = {
  size(path) {
    const handle = new File(path).open(FileMode.ReadOnly);
    try {
      const size = handle.size;
      if (size === null) throw new Error('handle closed');
      return Promise.resolve(size);
    } finally {
      handle.close();
    }
  },
  read(path, offset, length) {
    return readThrough(path, offset, length);
  },
  write(path, bytes, offset) {
    dropWindow(path);
    const handle = new File(path).open(FileMode.ReadWrite);
    try {
      handle.offset = offset;
      handle.writeBytes(bytes);
      return Promise.resolve();
    } finally {
      handle.close();
    }
  },
  create(path) {
    dropWindow(path);
    const file = new File(path);
    if (file.exists) file.delete();
    file.create();
    return Promise.resolve();
  },
  delete(path) {
    dropWindow(path);
    const file = new File(path);
    if (file.exists) file.delete();
    return Promise.resolve();
  },
  copyRanges(src, dst, ranges) {
    return nativeCopyRanges(fsPath(src), fsPath(dst), ranges);
  },
};
