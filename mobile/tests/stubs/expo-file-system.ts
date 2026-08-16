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
  write(_content: string): void {}
}

export const FileMode = { ReadWrite: 'w', ReadOnly: 'r' };

export const Paths = { cache: '/stub/cache' };