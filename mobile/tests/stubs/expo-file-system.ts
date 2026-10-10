// parseable stand-in for expo-file-system (real entry is flow, rolldown
// chokes on it when it becomes part of a test module graph)
export class File {
  uri = '';
  exists = false;
  size = 0;
  name = '';
  constructor(_dir: unknown, name?: string) {
    this.name = name ?? 'stub';
  }
  delete(): void {}
  create(): void {}
  open(_mode: string): unknown {
    return {
      offset: 0,
      readBytes: () => new Uint8Array(0),
      writeBytes: (_b: Uint8Array) => {},
      close: () => {},
    };
  }
  text(): Promise<string> {
    return Promise.resolve('');
  }
  bytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }
  write(_content: string): void {}
}

export const FileMode = { ReadWrite: 'w', ReadOnly: 'r' };

export const Paths = { cache: '/stub/cache' };

// legacy entry stand-ins (aliased per-subpath in vitest config)
export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };

export function readAsStringAsync(): Promise<string> {
  return Promise.resolve('');
}

export function writeAsStringAsync(): Promise<void> {
  return Promise.resolve();
}

export const FileSystemUploadType = { BINARY_CONTENT: 0, MULTIPART: 1 };

export function uploadAsync(): Promise<{
  status: number;
  body: string;
  headers: Record<string, string>;
}> {
  return Promise.resolve({ status: 200, body: '{}', headers: {} });
}
