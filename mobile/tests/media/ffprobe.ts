import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
}

export interface ProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: ProbeFormat;
}

export function binAvailable(name: 'ffmpeg' | 'ffprobe'): boolean {
  const bin = process.env[`${name.toUpperCase()}_BIN`] ?? name;
  const res = spawnSync(bin, ['-version'], { timeout: 5000 });
  return res.status === 0;
}

export function ffmpegBin(): string {
  return process.env.FFMPEG_BIN ?? 'ffmpeg';
}

export function ffprobeBin(): string {
  return process.env.FFPROBE_BIN ?? 'ffprobe';
}

async function rawProbe(
  bin: string,
  args: string[],
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string } | null> {
  const overridden = process.env[`${bin.toUpperCase()}_BIN`];
  try {
    const { stdout, stderr } = await execFileP(bin, args, { timeout: timeoutMs });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (err: unknown) {
    if (overridden !== undefined) throw err;
    return null;
  }
}

export async function ffprobeJson(
  path: string
): Promise<ProbeResult | null> {
  const out = await rawProbe(ffprobeBin(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  if (!out) return null;
  try {
    return JSON.parse(out.stdout) as ProbeResult;
  } catch {
    return null;
  }
}

export function videoStreams(probe: ProbeResult): ProbeStream[] {
  return probe.streams.filter((s) => s.codec_type === 'video');
}

export function audioStreams(probe: ProbeResult): ProbeStream[] {
  return probe.streams.filter((s) => s.codec_type === 'audio');
}

export function durationSec(probe: ProbeResult): number {
  const d = probe.format.duration;
  if (d === undefined) return NaN;
  return Number.parseFloat(d);
}