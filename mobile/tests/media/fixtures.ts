import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ffmpegBin } from './ffprobe';

const execFileP = promisify(execFile);

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '.fixtures'
);

const MARKER = '.generated';

export interface FixtureSet {
  muxed: string;
  videoOnly: string;
  audioOnly: string;
  webm: string;
  fmp4: string;
  hlsPlaylist: string;
  hlsFmp4Dir: string;
  hlsVideoDir: string;
  hlsAudioDir: string;
  hlsAudioTsDir: string;
  audioFrag: string;
  coverWebp: string;
  coverJpg: string;
  musicMp3: string;
  taggedM4a: string;
}

const TINY_VIDEO =
  '-f lavfi -i testsrc2=size=320x240:rate=15:duration=2';
const TINY_AUDIO = '-f lavfi -i sine=frequency=440:duration=2';

async function ffmpeg(args: string[]): Promise<void> {
  await execFileP(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    timeout: 120000,
  });
}

async function generate(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });

  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    ...TINY_AUDIO.split(' '),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-c:a', 'aac', '-movflags', '+faststart',
    join(FIXTURE_DIR, 'muxed.mp4'),
  ]);

  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    join(FIXTURE_DIR, 'video.mp4'),
  ]);
  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'aac', '-b:a', '64k',
    join(FIXTURE_DIR, 'audio.m4a'),
  ]);

  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    ...TINY_AUDIO.split(' '),
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '100k',
    '-c:a', 'libopus',
    join(FIXTURE_DIR, 'webm.webm'),
  ]);

  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    ...TINY_AUDIO.split(' '),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    join(FIXTURE_DIR, 'fmp4.mp4'),
  ]);

  const hlsDir = join(FIXTURE_DIR, 'hls');
  await fs.mkdir(hlsDir, { recursive: true });
  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    ...TINY_AUDIO.split(' '),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'mpegts',
    join(hlsDir, 'playlist.m3u8'),
  ]);

  const hlsFmp4Dir = join(FIXTURE_DIR, 'hls-fmp4');
  await fs.mkdir(hlsFmp4Dir, { recursive: true });
  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    ...TINY_AUDIO.split(' '),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-c:a', 'aac', '-hls_segment_filename', join(hlsFmp4Dir, 'seg-%d.m4s'),
    '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'fmp4',
    join(hlsFmp4Dir, 'playlist.m3u8'),
  ]);

  const hlsVideoDir = join(FIXTURE_DIR, 'hls-v');
  await fs.mkdir(hlsVideoDir, { recursive: true });
  await ffmpeg([
    ...TINY_VIDEO.split(' '),
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'fmp4',
    join(hlsVideoDir, 'v.m3u8'),
  ]);

  const hlsAudioDir = join(FIXTURE_DIR, 'hls-a');
  await fs.mkdir(hlsAudioDir, { recursive: true });
  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'fmp4',
    join(hlsAudioDir, 'a.m3u8'),
  ]);

  const hlsAudioTsDir = join(FIXTURE_DIR, 'hls-audio');
  await fs.mkdir(hlsAudioTsDir, { recursive: true });
  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'mpegts',
    join(hlsAudioTsDir, 'audio.m3u8'),
  ]);

  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'aac', '-b:a', '64k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    join(FIXTURE_DIR, 'audio-f.mp4'),
  ]);

  await ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=red:size=640x480:duration=1',
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80',
    join(FIXTURE_DIR, 'cover.webp'),
  ]);

  await ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=blue:size=640x480:duration=1',
    '-frames:v', '1', '-q:v', '2',
    join(FIXTURE_DIR, 'cover.jpg'),
  ]);

  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'libmp3lame', '-q:a', '2',
    join(FIXTURE_DIR, 'music.mp3'),
  ]);

  await ffmpeg([
    ...TINY_AUDIO.split(' '),
    '-vn', '-c:a', 'aac', '-metadata', 'title=Phantom Test',
    '-metadata', 'artist=XB', '-metadata', 'album=Plan',
    join(FIXTURE_DIR, 'tagged.m4a'),
  ]);

  await fs.writeFile(join(FIXTURE_DIR, MARKER), '1', 'utf8');
}

export async function paths(): Promise<FixtureSet> {
  try {
    await fs.access(join(FIXTURE_DIR, MARKER));
  } catch {
    await generate();
  }
  return {
    muxed: join(FIXTURE_DIR, 'muxed.mp4'),
    videoOnly: join(FIXTURE_DIR, 'video.mp4'),
    audioOnly: join(FIXTURE_DIR, 'audio.m4a'),
    webm: join(FIXTURE_DIR, 'webm.webm'),
    fmp4: join(FIXTURE_DIR, 'fmp4.mp4'),
    hlsPlaylist: join(hls(), 'playlist.m3u8'),
    hlsFmp4Dir: join(FIXTURE_DIR, 'hls-fmp4'),
    hlsVideoDir: join(FIXTURE_DIR, 'hls-v'),
    hlsAudioDir: join(FIXTURE_DIR, 'hls-a'),
    hlsAudioTsDir: join(FIXTURE_DIR, 'hls-audio'),
  audioFrag: join(FIXTURE_DIR, 'audio-f.mp4'),
    coverWebp: join(FIXTURE_DIR, 'cover.webp'),
    coverJpg: join(FIXTURE_DIR, 'cover.jpg'),
    musicMp3: join(FIXTURE_DIR, 'music.mp3'),
    taggedM4a: join(FIXTURE_DIR, 'tagged.m4a'),
  };
}

function hls(): string {
  return join(FIXTURE_DIR, 'hls');
}