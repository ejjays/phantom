import { File, FileMode } from 'expo-file-system';
import type { MediaIO } from './io';
import { copyRanges as nativeCopyRanges } from '../../../modules/mediacopy';

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
    const handle = new File(path).open(FileMode.ReadOnly);
    try {
      handle.offset = offset;
      return Promise.resolve(handle.readBytes(length));
    } finally {
      handle.close();
    }
  },
  write(path, bytes, offset) {
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
    const file = new File(path);
    if (file.exists) file.delete();
    file.create();
    return Promise.resolve();
  },
  delete(path) {
    const file = new File(path);
    if (file.exists) file.delete();
    return Promise.resolve();
  },
  copyRanges(src, dst, ranges) {
    return nativeCopyRanges(src, dst, ranges);
  },
};
