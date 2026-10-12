import type { Format, ProviderStreams, VideoInfo } from '@phantom/extractors';
import { formatLabel } from './download/format';

export function providerGroups(info: VideoInfo | null): ProviderStreams[] {
  return info?.providers?.filter((group) => group.formats.length > 0) ?? [];
}

export function scopedFormats(
  info: VideoInfo | null,
  key: string | null
): Format[] {
  if (!key) return info?.formats ?? [];
  const found = providerGroups(info).find((group) => group.key === key);
  return found?.formats ?? info?.formats ?? [];
}

export function matchHeight(
  formats: Format[],
  height: number | undefined
): Format | undefined {
  if (formats.length === 0) return undefined;
  return height === undefined
    ? formats[0]
    : (formats.find((format) => format.height === height) ?? formats[0]);
}

export function visibleFormats(
  info: VideoInfo | null,
  key: string | null,
  currentId: string | null
): Format[] {
  const out: Format[] = [];
  for (const format of scopedFormats(info, key)) {
    if (format.formatId === currentId) {
      const twin = out.findIndex(
        (entry) => formatLabel(entry) === formatLabel(format)
      );
      if (twin >= 0) out[twin] = format;
      else out.push(format);
    } else if (
      !out.some((entry) => formatLabel(entry) === formatLabel(format))
    ) {
      out.push(format);
    }
  }
  return out;
}
