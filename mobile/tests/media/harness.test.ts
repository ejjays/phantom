import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  audioStreams,
  binAvailable,
  durationSec,
  ffprobeJson,
  videoStreams,
} from './ffprobe';
import { FIXTURE_DIR, paths } from './fixtures';
import { ascii, be32, box, emptyBox, concat, mvhd } from '../../src/lib/media/boxes';

function trivialMp4(): Uint8Array {
  const ftyp = box(
    'ftyp',
    concat(ascii('isom'), be32(512), ascii('isom'), ascii('iso2'), ascii('mp41'))
  );
  return concat(ftyp, emptyBox('mdat'), box('moov', mvhd(1000, 2000, 1)));
}

const SUITE = binAvailable('ffmpeg') && binAvailable('ffprobe');

describe.skipIf(!SUITE)('ffprobe oracle', () => {
  let set: Awaited<ReturnType<typeof paths>>;

  beforeAll(async () => {
    set = await paths();
  });

  it.each([
    ['muxed.mp4 matches a facebook-style muxed file', 'muxed', 1, 'h264', 1, 'aac'],
    ['video.mp4 is video-only', 'videoOnly', 1, 'h264', 0],
    ['audio.m4a is audio-only', 'audioOnly', 0, undefined, 1, 'aac'],
    ['webm.webm is vp9+opus', 'webm', 1, 'vp9', 1, 'opus'],
    ['fmp4.mp4 is fragmented', 'fmp4', 1, 'h264', 1, 'aac'],
    ['hls playlist demuxes', 'hlsPlaylist', 1, 'h264', 1, 'aac'],
    ['cover.webp is a webp image', 'coverWebp', 1, 'webp', 0],
    ['music.mp3 is mp3', 'musicMp3', 0, undefined, 1, 'mp3'],
    ['tagged.m4a carries aac', 'taggedM4a', 0, undefined, 1, 'aac'],
  ])('%s', async (_label, key, videoCount, videoCodec, audioCount, audioCodec?) => {
    const probe = await ffprobeJson(set[key as keyof typeof set]);
    expect(probe, `${key} failed to probe`).not.toBeNull();
    if (probe === null) return;
    expect(videoStreams(probe).length).toBe(videoCount);
    expect(audioStreams(probe).length).toBe(audioCount);
    if (videoCodec !== undefined) {
      expect(videoStreams(probe)[0].codec_name).toBe(videoCodec);
    }
    if (audioCodec !== undefined) {
      expect(audioStreams(probe)[0].codec_name).toBe(audioCodec);
    }
  });

  it('media carries ~2s duration for progress math', async () => {
    const probe = await ffprobeJson(set.muxed);
    if (probe === null) return;
    expect(durationSec(probe)).toBeGreaterThan(1.5);
    expect(durationSec(probe)).toBeLessThan(3);
  });

  it('box writer emits correct big-endian bytes', () => {
    expect(Array.from(emptyBox('free'))).toEqual([
      0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
    ]);
    expect(Array.from(box('abcd', ascii('xy')))).toEqual([
      0x00, 0x00, 0x00, 0x0a, 0x61, 0x62, 0x63, 0x64, 0x78, 0x79,
    ]);
    expect(Array.from(be32(512))).toEqual([0, 0, 2, 0]);
  });

  it('trivial hand-rolled mp4 validates through the oracle', async () => {
    const file = join(FIXTURE_DIR, 'trivial-hand.mp4');
    await fs.writeFile(file, trivialMp4());
    const probe = await ffprobeJson(file);
    expect(probe, 'trivial mp4 must probe clean').not.toBeNull();
    if (probe === null) return;
    expect(probe.format.format_name).toContain('mp4');
  });
});