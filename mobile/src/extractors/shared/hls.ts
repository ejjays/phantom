import { Format } from './types';
import { gatedFetch } from '../../lib/net';

// master -> per-quality variants; separate audio rendition if present, else muxed
export async function parseHlsMaster(
  master: string,
  durationSec: number,
  headers?: Record<string, string>
): Promise<Format[]> {
  let text: string;
  try {
    const res = await gatedFetch(master, { headers });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }
  const lines = text.split('\n');
  let audioUrl: string | undefined;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/u.test(line)) {
      const uri = line.match(/URI="([^"]+)"/u)?.[1];
      if (uri) {
        audioUrl = new URL(uri, master).toString();
        break;
      }
    }
  }
  const seen = new Set<number>();
  const formats: Format[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = lines[i];
    const dims = attrs.match(/RESOLUTION=(\d+)x(\d+)/u);
    const uri = lines[i + 1]?.trim();
    if (!dims || !uri || uri.startsWith('#')) continue;
    const height = Number(dims[2]);
    if (seen.has(height)) continue;
    seen.add(height);
    const bw = Number(
      attrs.match(/AVERAGE-BANDWIDTH=(\d+)/u)?.[1] ??
        attrs.match(/[^-]BANDWIDTH=(\d+)/u)?.[1] ??
        0
    );
    const codecs = attrs.match(/CODECS="([^"]+)"/u)?.[1] ?? '';
    formats.push({
      formatId: `${height}p`,
      url: new URL(uri, master).toString(),
      hlsAudioUrl: audioUrl,
      extension: 'mp4',
      resolution: `${dims[1]}x${dims[2]}`,
      quality: `${height}p`,
      width: Number(dims[1]),
      height,
      filesize:
        bw > 0 && durationSec > 0
          ? Math.round((bw / 8) * durationSec)
          : undefined,
      vcodec: /av01/u.test(codecs)
        ? 'av1'
        : /hvc1|hev1/u.test(codecs)
          ? 'hevc'
          : 'h264',
      acodec: 'aac',
      isVideo: true,
      isAudio: false,
      isMuxed: true,
      isHls: true,
      hlsKeepAlive: true,
    });
  }
  formats.sort((lhs, rhs) => (rhs.height ?? 0) - (lhs.height ?? 0));
  return formats;
}

// largest sized thumbnail
export function pickLargestThumb(
  thumbs?: Record<string, string>
): string | undefined {
  if (!thumbs) return undefined;
  const sized = Object.entries(thumbs)
    .filter(([key]) => /^\d+$/u.test(key))
    .sort((lhs, rhs) => Number(rhs[0]) - Number(lhs[0]));
  return sized[0]?.[1] ?? thumbs.base ?? Object.values(thumbs)[0];
}
