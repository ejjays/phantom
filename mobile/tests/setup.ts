import { vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  getRandomValues: <T extends Uint32Array | Uint8Array>(arr: T): T => {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = Math.floor(Math.random() * 0x100000000);
    }
    return arr;
  },
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));
