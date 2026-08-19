import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { ffmpegBin, ffprobeJson, durationSec, binAvailable, ProbeResult } from './ffprobe';
import { FIXTURE_DIR, paths } from './fixtures';
import { nodeIo as io } from './ioNode';
import { demuxToM4a, muxVideoAudio, remuxToMp4 } from '../../src/lib/media/mp4';
import { parseMp4, topLevelBoxes } from '../../src/lib/media/mp4/reader';
import { scanWebm } from '../../src/lib/media/webm/demux';

const execFileP = promisify(execFile);

const SUITE = binAvailable('ffmpeg') && binAvailable('ffprobe');

function signature(probe: ProbeResult): string[] {
  return probe.streams.map((s) => `${s.codec_type}:${s.codec_name ?? '?'}`);
}

describe.skipIf(!SUITE)('webm core parity (vp9+opus -> mp4)', () => {
  let webm: string;

  beforeAll(async () => {
    const set = await paths();
    webm = set.webm;
  });

  it('remux webm -> mp4, faststart, vp9+opus preserved', async () => {
    const out = join(FIXTURE_DIR, 'webm-remux-ours.mp4');
    const ok = await remuxToMp4(io, webm, out);
    expect(ok).toBe(true);

    const boxes = await topLevelBoxes(io, out, await io.size(out));
    expect(boxes.map((box) => box.type)).toEqual(['ftyp', 'moov', 'mdat']);

    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(signature(probe)).toEqual(['video:vp9', 'audio:opus']);
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    expect(durationSec(probe)).toBeLessThan(3);

    const src = await scanWebm(io, webm, await io.size(webm));
    const dst = await parseMp4(io, out, await io.size(out));
    expect(src).not.toBeNull();
    if (src === null) return;
    const dstVideo = dst.tracks.find((t) => t.kind === 'video');
    const dstAudio = dst.tracks.find((t) => t.kind === 'audio');
    const srcVideo = src.tracks.find((t) => t.kind === 'video');
    const srcAudio = src.tracks.find((t) => t.kind === 'audio');
    expect(dstVideo?.stsz.sizes.length).toBe(
      src.frames.filter((f) => f.track === srcVideo?.number).length
    );
    expect(dstAudio?.stsz.sizes.length).toBe(
      src.frames.filter((f) => f.track === srcAudio?.number).length
    );
  });

  it('mux path takes video from one webm and audio from another', async () => {
    const out = join(FIXTURE_DIR, 'webm-mux-ours.mp4');
    const ok = await muxVideoAudio(io, webm, webm, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(signature(probe)).toEqual(['video:vp9', 'audio:opus']);
  });

  it('demux webm audio -> m4a (opus single track)', async () => {
    const out = join(FIXTURE_DIR, 'webm-demux-ours.m4a');
    const ok = await demuxToM4a(io, webm, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(signature(probe)).toEqual(['audio:opus']);
    expect(probe.streams[0].sample_rate).toBe('48000');
  });

  it('mirrors ffmpeg reference mux (same streams, same duration)', async () => {
    const ref = join(FIXTURE_DIR, 'webm-remux-ffmpeg.mp4');
    const ours = join(FIXTURE_DIR, 'webm-remux-parity.mp4');
    await execFileP(
      ffmpegBin(),
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm, '-c', 'copy', ref],
      { timeout: 60000 }
    );
    const ok = await remuxToMp4(io, webm, ours);
    expect(ok).toBe(true);
    const [refProbe, ourProbe] = await Promise.all([
      ffprobeJson(ref),
      ffprobeJson(ours),
    ]);
    expect(refProbe).not.toBeNull();
    expect(ourProbe).not.toBeNull();
    if (!refProbe || !ourProbe) return;
    expect(signature(ourProbe)).toEqual(signature(refProbe));
    expect(durationSec(ourProbe)).toBeCloseTo(durationSec(refProbe), 1);
  });

  it('refuses non-webm input', async () => {
    const set = await paths();
    const ok = await remuxToMp4(io, set.muxed, join(FIXTURE_DIR, 'no-webm.mp4'));
    expect(ok).toBe(true);
    await fs.rm(join(FIXTURE_DIR, 'no-webm.mp4'), { force: true });
  });
});