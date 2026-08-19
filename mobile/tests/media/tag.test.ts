import { beforeAll, describe, expect, it } from 'vitest';
import { binAvailable, ffprobeJson, durationSec } from './ffprobe';
import { paths, FIXTURE_DIR } from './fixtures';
import { nodeIo as io } from './ioNode';
import { tagAudio, buildId3v2 } from '../../src/lib/media/tag';
import { parseMp4, children, find } from '../../src/lib/media/mp4/reader';
import { join } from 'node:path';

describe.skipIf(!binAvailable('ffprobe'))('tag core', () => {
  let set: Awaited<ReturnType<typeof paths>>;

  beforeAll(async () => {
    set = await paths();
  });

  it('id3v2 tag prepends text frames', () => {
    const tag = buildId3v2({ title: 'Song', artist: 'Artist', album: 'Album' }, null);
    expect(String.fromCharCode(tag[0], tag[1], tag[2])).toBe('ID3');
    expect(tag[3]).toBe(3);
    expect(tag.length).toBeGreaterThan(40);
  });

  it('id3v2 skips empty meta', () => {
    expect(buildId3v2({}, null).length).toBe(0);
    expect(buildId3v2({ title: '' }, null).length).toBe(0);
  });

  it('tags mp3 with text + cover, stream intact', async () => {
    const out = join(FIXTURE_DIR, 'tagged-ours.mp3');
    const ok = await tagAudio(io, set.musicMp3, out, { title: 'Phantom Song', artist: 'XB', album: 'Plan' }, set.coverJpg);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(probe.format.tags?.title).toBe('Phantom Song');
    expect(probe.format.tags?.artist).toBe('XB');
    expect(probe.format.tags?.album).toBe('Plan');
    const pic = probe.streams.find((s) => s.disposition?.attached_pic === 1);
    expect(pic).toBeDefined();
    expect(durationSec(probe)).toBeGreaterThan(1.5);
  });

  it('tags m4a with ilst atoms + cover, duration preserved', async () => {
    const out = join(FIXTURE_DIR, 'tagged-ours.m4a');
    const ok = await tagAudio(io, set.audioOnly, out, { title: 'Phantom Song', artist: 'XB', album: 'Plan' }, set.coverJpg);
    expect(ok).toBe(true);
    const [probe, srcProbe] = await Promise.all([ffprobeJson(out), ffprobeJson(set.audioOnly)]);
    expect(probe).not.toBeNull();
    expect(srcProbe).not.toBeNull();
    if (probe === null || srcProbe === null) return;
    expect(probe.format.tags?.title).toBe('Phantom Song');
    expect(probe.format.tags?.artist).toBe('XB');
    expect(probe.format.tags?.album).toBe('Plan');
    expect(Math.abs(durationSec(probe) - durationSec(srcProbe))).toBeLessThan(0.2);
  });

  it('tagged m4a keeps a parseable audio track', async () => {
    const out = join(FIXTURE_DIR, 'tagged-ours.m4a');
    const info = await parseMp4(io, out, await io.size(out));
    const audio = info.tracks.find((t) => t.kind === 'audio');
    expect(audio).toBeDefined();
    expect(audio?.stsz.sizes.length).toBeGreaterThan(0);
    const udta = find(children(info.moov, 8, info.moov.length), 'udta');
    expect(udta).toBeDefined();
    if (udta === undefined) return;
    const meta = find(children(info.moov, udta.start + 8, udta.end), 'meta');
    expect(meta).toBeDefined();
    if (meta === undefined) return;
    const ilst = find(children(info.moov, meta.start + 12, meta.end), 'ilst');
    expect(ilst).toBeDefined();
  });

  it('no-op tag still produces a playable copy', async () => {
    const out = join(FIXTURE_DIR, 'untagged-ours.mp3');
    expect(await tagAudio(io, set.musicMp3, out, {})).toBe(true);
    const probe = await ffprobeJson(out);
    expect(probe).not.toBeNull();
    if (probe === null) return;
    expect(durationSec(probe)).toBeGreaterThan(1.5);
  });
});
