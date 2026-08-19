import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ffprobeJson, durationSec } from './ffprobe';
import { nodeIo as io } from './ioNode';
import { muxVideoAudio } from '../../src/lib/media/mp4';
import { topLevelBoxes } from '../../src/lib/media/mp4/reader';

const DIR = '/data/data/com.termux/files/home/phantom/mobile/tests/media';
const PAIRS = [
  { name: 'real-av1-4k', video: '/data/data/com.termux/files/usr/tmp/opencode/yt3/v401.mp4', audio: '/data/data/com.termux/files/usr/tmp/opencode/yt3/a140.m4a', out: `${DIR}/real4k-muxed.mp4` },
];

// sanity floor: header-only output carries durations in moov timestamps, so
// assert real media bytes landed (mdat > 1MB), not just probe metadata
describe('real youtube fmp4 end-to-end', () => {
  for (const pair of PAIRS) {
    it(`${pair.name}: mux writes real mdat and plays`, async () => {
      const missing = !existsSync(pair.video) || !existsSync(pair.audio);
      if (missing) return;  
      await fs.rm(pair.out, { force: true });
      const ok = await muxVideoAudio(io, pair.video, pair.audio, pair.out);
      expect(ok).toBe(true);
      const boxes = await topLevelBoxes(io, pair.out, await io.size(pair.out));
      const mdat = boxes.filter((box) => box.type === 'mdat');
      expect(mdat.length).toBe(1);
      expect(mdat[0].size).toBeGreaterThan(1024 * 1024);
      expect(boxes.map((box) => box.type).join(',')).toBe('ftyp,moov,mdat');
      const probe = await ffprobeJson(pair.out);
      expect(probe).not.toBeNull();
      if (!probe) return;
      expect(probe.streams.map((s) => s.codec_type).sort().join(',')).toBe('audio,video');
      expect(durationSec(probe)).toBeGreaterThan(10);
    });
  }
});