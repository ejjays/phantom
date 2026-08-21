import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { binAvailable, durationSec, ffprobeJson } from './ffprobe';
import { nodeIo as io } from './ioNode';
import { remuxTsToMp4 } from '../../src/lib/media/ts/toMp4';

const SRC = '/data/data/com.termux/files/usr/tmp/opencode/bs_concat.ts';
const OUT = '/data/data/com.termux/files/usr/tmp/opencode/bs_ours.mp4';

describe.skipIf(!binAvailable('ffprobe'))('bluesky real-world ts remux', () => {
  it('remuxes the exact failing bsky hls concat', async () => {
    await fs.rm(OUT, { force: true });
    const ok = await remuxTsToMp4(io, SRC, OUT);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(OUT);
    if (!probe) throw new Error('ffprobe failed');
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(durationSec(probe)).toBeGreaterThan(30);
  });
});
