import {
  muxToMp4 as muxToMp4Core,
  isClientMuxSupported,
  type MuxOptions,
} from '@phantom/web-mux';
import muxWorkerUrl from '@phantom/web-mux/worker?worker&url';

export type { MuxOptions, MuxProgress } from '@phantom/web-mux';
export { isClientMuxSupported };

// filePrefix keeps legacy phantom-mux OPFS scratch names sweepable
export function muxToMp4(options: MuxOptions): Promise<Blob> {
  return muxToMp4Core({
    filePrefix: 'phantom-mux',
    workerUrl: muxWorkerUrl,
    ...options,
  });
}