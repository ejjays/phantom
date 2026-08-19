// file abstraction the media core works on — node impl lives in tests,
// rn impl (expo FileHandle: offset seek + readBytes/writeBytes) wires at swap.
export interface MediaIO {
  size(path: string): Promise<number>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, offset: number): Promise<void>;
  create(path: string): Promise<void>;
  delete(path: string): Promise<void>;
}