import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { ffmpegBin, ffprobeJson, durationSec, binAvailable } from './ffprobe';
import { FIXTURE_DIR, paths } from './fixtures';
import { nodeIo as io } from './ioNode';
import { demuxToM4a, muxVideoAudio, remuxToMp4 } from '../../src/lib/media/mp4';
import { parseMp4, topLevelBoxes } from '../../src/lib/media/mp4/reader';

const execFileP = promisify(execFile);

const SUITE = binAvailable('ffmpeg') && binAvailable('ffprobe');

function streamSignature(probe: NonNullable<Awaited<ReturnType<typeof ffprobeJson>>>): string[] {
  return probe.streams.map((s) => `${s.codec_type}:${s.codec_name ?? '?'}`);
}

describe.skipIf(!SUITE)('mp4 core parity', () => {
  let set: Awaited<ReturnType<typeof paths>>;

  beforeAll(async () => {
    set = await paths();
  });

  async function ffmpegReference(args: string[], out: string): Promise<void> {
    await execFileP(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], {
      timeout: 120000,
    });
  }

  async function assertFaststart(file: string): Promise<void> {
    const boxes = await topLevelBoxes(io, file, await io.size(file));
    expect(boxes.map((box) => box.type)).toEqual(['ftyp', 'moov', 'mdat']);
  }

  it('mux video+audio, faststart, sample count preserved', async () => {
    const out = join(FIXTURE_DIR, 'muxed-ours.mp4');
    const ok = await muxVideoAudio(io, set.videoOnly, set.audioOnly, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['video:h264', 'audio:aac']);
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    expect(durationSec(probe)).toBeLessThan(3);
    await assertFaststart(out);

    const src = await parseMp4(io, set.videoOnly, await io.size(set.videoOnly));
    const dst = await parseMp4(io, out, await io.size(out));
    expect(dst.tracks.find((t) => t.kind === 'video')?.stsz.sizes.length).toBe(
      src.tracks[0].stsz.sizes.length
    );
  });

  it('refuses to report ok when tail writes silently vanish', async () => {
    const out = join(FIXTURE_DIR, 'muxed-dropped.mp4');
    let used = 0;
    const dropper: typeof io = {
      ...io,
      write: (path, bytes, offset) => {
        // cede partway through the mdat payload so trailing chunk writes
        // silently no-op, exactly like the device moov-only-output repro
        if (used >= 65536) return Promise.resolve();
        used += bytes.length;
        return io.write(path, bytes, offset);
      },
    };
    const ok = await muxVideoAudio(dropper, set.videoOnly, set.audioOnly, out);
    expect(ok).toBe(false);
  });

  it('mux output structurally matches ffmpeg reference mux', async () => {
    const ref = join(FIXTURE_DIR, 'muxed-ref.mp4');
    await ffmpegReference(
      ['-i', set.videoOnly, '-i', set.audioOnly, '-c', 'copy', '-movflags', '+faststart'],
      ref
    );
    const ours = join(FIXTURE_DIR, 'muxed-ours.mp4');
    const [refProbe, oursProbe] = await Promise.all([ffprobeJson(ref), ffprobeJson(ours)]);
    expect(refProbe).not.toBeNull();
    expect(oursProbe).not.toBeNull();
    if (!refProbe || !oursProbe) return;
    expect(streamSignature(oursProbe)).toEqual(streamSignature(refProbe));
    expect(durationSec(oursProbe)).toBeCloseTo(durationSec(refProbe), 1);
  });

  it('demux audio out of a muxed file, lossless, no video track', async () => {
    const out = join(FIXTURE_DIR, 'demuxed-ours.m4a');
    const ok = await demuxToM4a(io, set.muxed, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['audio:aac']);
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    await assertFaststart(out);

    const src = await parseMp4(io, set.muxed, await io.size(set.muxed));
    const dst = await parseMp4(io, out, await io.size(out));
    const srcAudio = src.tracks.find((t) => t.kind === 'audio');
    const dstAudio = dst.tracks.find((t) => t.kind === 'audio');
    expect(dstAudio?.stsz.sizes.length).toBe(srcAudio?.stsz.sizes.length);
  });

  it('remux preserves both tracks and faststarts', async () => {
    const out = join(FIXTURE_DIR, 'remuxed-ours.mp4');
    const ok = await remuxToMp4(io, set.muxed, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['video:h264', 'audio:aac']);
    await assertFaststart(out);
  });

  // youtube 4k styles: fragmented inputs with an empty moov
  it('mux fragmented video input (empty moov), no staged leftovers', async () => {
    const out = join(FIXTURE_DIR, 'staged-v.mp4');
    const ok = await muxVideoAudio(io, set.fmp4, set.audioOnly, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['video:h264', 'audio:aac']);
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    await assertFaststart(out);
    expect(existsSync(`${set.fmp4}.prog.mp4`)).toBe(false);
    expect(existsSync(`${set.audioOnly}.prog.mp4`)).toBe(false);
  });

  it('mux fragmented audio input (empty moov)', async () => {
    const out = join(FIXTURE_DIR, 'staged-a.mp4');
    const ok = await muxVideoAudio(io, set.videoOnly, set.audioFrag, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['video:h264', 'audio:aac']);
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    expect(existsSync(`${set.audioFrag}.prog.mp4`)).toBe(false);
  });

  it('rejects files with no moov', async () => {
    const junk = join(FIXTURE_DIR, 'junk.mp4');
    await fs.writeFile(junk, Buffer.from('not an mp4 at all'));
    expect(await remuxToMp4(io, junk, join(FIXTURE_DIR, 'junk-out.mp4'))).toBe(false);
    expect(await demuxToM4a(io, junk, join(FIXTURE_DIR, 'junk-out2.m4a'))).toBe(false);
  });

  it('demux round-trip: mux(v,a) then demux equals source audio shape', async () => {
    const muxed = join(FIXTURE_DIR, 'muxed-ours.mp4');
    const out = join(FIXTURE_DIR, 'roundtrip.m4a');
    expect(await demuxToM4a(io, muxed, out)).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(streamSignature(probe)).toEqual(['audio:aac']);
    expect(durationSec(probe)).toBeCloseTo(2, 0);
  });

  it('reads moov-at-end files (typical server downloads)', async () => {
    const noFaststart = join(FIXTURE_DIR, 'moov-end.mp4');
    await ffmpegReference(['-i', set.muxed, '-c', 'copy'], noFaststart);
    const out = join(FIXTURE_DIR, 'moov-end-ours.mp4');
    expect(await remuxToMp4(io, noFaststart, out)).toBe(true);
    const boxes = await topLevelBoxes(io, out, await io.size(out));
    expect(boxes.map((box) => box.type)).toEqual(['ftyp', 'moov', 'mdat']);
  });
});