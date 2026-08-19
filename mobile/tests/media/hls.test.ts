import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { binAvailable, durationSec, ffprobeJson } from './ffprobe';
import { paths } from './fixtures';
import { nodeIo as io } from './ioNode';
import { hlsConcatToMp4, hlsMergeToMp4 } from '../../src/lib/media/mp4';
import { hlsFileToProgressive } from '../../src/lib/media/mp4/fragments';
import { demuxTsToM4a } from '../../src/lib/media/ts/demux';

const SUITE = binAvailable('ffmpeg') && binAvailable('ffprobe');

// concat a hls playlist the way the app does: init segment (EXT-X-MAP) first,
// then every segment uri in order.
async function concatPlaylist(dir: string, playlist: string, out: string): Promise<void> {
  const text = await fs.readFile(playlist, 'utf8');
  const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/u)?.[1];
  const uris = [...text.matchAll(/^([^#\r\n][^\r\n]*)$/gmu)].map((hit) => hit[1].trim()).filter(Boolean);
  const parts: Buffer[] = [];
  if (map) parts.push(await fs.readFile(join(dir, map)));
  for (const uri of uris) parts.push(await fs.readFile(join(dir, uri)));
  await fs.writeFile(out, Buffer.concat(parts));
}

describe.skipIf(!SUITE)('hls pure-ts assembly', () => {
  let set: Awaited<ReturnType<typeof paths>>;

  beforeAll(async () => {
    set = await paths();
  });

  it('converts a single fragmented mp4 to progressive', async () => {
    const out = `${set.fmp4}.out.mp4`;
    await fs.rm(out, { force: true });
    const ok = await hlsFileToProgressive(io, set.fmp4, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    if (!probe) throw new Error('ffprobe failed');
    expect(durationSec(probe)).toBeCloseTo(2.0, 0);
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  });

  it('remuxes an fmp4 hls concat (init + segments) to progressive', async () => {
    const concat = join(set.hlsFmp4Dir, 'concat.m4s');
    await fs.rm(concat, { force: true });
    await concatPlaylist(set.hlsFmp4Dir, join(set.hlsFmp4Dir, 'playlist.m3u8'), concat);
    const out = join(set.hlsFmp4Dir, 'concat.out.mp4');
    await fs.rm(out, { force: true });
    const ok = await hlsFileToProgressive(io, concat, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    if (!probe) throw new Error('ffprobe failed');
    expect(durationSec(probe)).toBeCloseTo(2.0, 0);
    const streams = probe.streams;
    expect(streams.filter((s) => s.codec_type === 'video').length).toBe(1);
    expect(streams.filter((s) => s.codec_type === 'audio').length).toBe(1);
    const audio = streams.find((s) => s.codec_type === 'audio');
    expect(audio?.sample_rate).toBe('44100');
    expect(audio?.channels).toBe(1);
  });

  it('merges separate video and audio fmp4 hls concats', async () => {
    const vConcat = join(set.hlsVideoDir, 'v.m4s');
    const aConcat = join(set.hlsAudioDir, 'a.m4s');
    await fs.rm(vConcat, { force: true });
    await fs.rm(aConcat, { force: true });
    await concatPlaylist(set.hlsVideoDir, join(set.hlsVideoDir, 'v.m3u8'), vConcat);
    await concatPlaylist(set.hlsAudioDir, join(set.hlsAudioDir, 'a.m3u8'), aConcat);
    const out = join(set.hlsVideoDir, 'merged.mp4');
    await fs.rm(out, { force: true });
    const ok = await hlsMergeToMp4(io, vConcat, aConcat, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    if (!probe) throw new Error('ffprobe failed');
    expect(durationSec(probe)).toBeCloseTo(2.0, 0);
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  });

  it('demuxes an audio-only mpegts hls concat to m4a', async () => {
    const concat = join(set.hlsAudioTsDir, 'concat.ts');
    await fs.rm(concat, { force: true });
    await concatPlaylist(set.hlsAudioTsDir, join(set.hlsAudioTsDir, 'audio.m3u8'), concat);
    const out = join(set.hlsAudioTsDir, 'audio.m4a');
    await fs.rm(out, { force: true });
    const ok = await demuxTsToM4a(io, concat, out);
    expect(ok).toBe(true);
    const probe = await ffprobeJson(out);
    if (!probe) throw new Error('ffprobe failed');
    expect(durationSec(probe)).toBeCloseTo(2.0, 0);
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(audio).toBeDefined();
    expect(audio?.codec_name).toBe('aac');
    expect(audio?.sample_rate).toBe('44100');
    expect(audio?.channels).toBe(1);
  });

  it('refuses muxed mpegts hls (video present)', async () => {
    const concat = `${set.hlsPlaylist}.concat.ts`;
    await fs.rm(concat, { force: true });
    await concatPlaylist(join(set.hlsPlaylist, '..'), set.hlsPlaylist, concat);
    const out = `${set.hlsPlaylist}.muxed.ts.out.mp4`;
    await fs.rm(out, { force: true });
    const ok = await hlsConcatToMp4(io, concat, out);
    expect(ok).toBe(false);
  });
});
