import { describe, expect, it } from 'vitest';
import type { Format, ProviderStreams, VideoInfo } from '@phantom/extractors';
import { matchHeight, providerGroups, scopedFormats, visibleFormats } from '../src/lib/providers';

function formatOf(formatId: string, height?: number): Format {
  return {
    formatId,
    url: `https://cdn.example.com/${formatId}.m3u8`,
    extension: 'mp4',
    quality: height === undefined ? 'Auto' : `${height}p`,
    height,
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    isHls: true,
  };
}

function groupOf(key: string, heights: number[]): ProviderStreams {
  return {
    key,
    label: key,
    formats: heights.map((height) => formatOf(`${key}-${height}p`, height)),
    headers: {},
  };
}

function infoOf(groups: ProviderStreams[]): VideoInfo {
  return {
    type: 'video',
    id: '550',
    title: 'Fight Club',
    uploader: 'Phantom',
    webpageUrl: 'https://watchluna.gd/movie/550',
    formats: [formatOf('vidrock-auto'), formatOf('vidrock-1080p', 1080)],
    isJsInfo: true,
    fromBrain: false,
    isPartial: false,
    isIsrcMatch: false,
    isFullData: true,
    providers: groups,
  };
}

describe('providerGroups', () => {
  it('drops empty groups and tolerates missing info', () => {
    expect(providerGroups(null)).toEqual([]);
    expect(providerGroups(infoOf([]))).toEqual([]);
    const groups = providerGroups(infoOf([groupOf('vixsrc', [1080]), groupOf('dry', [])]));
    expect(groups.map((group) => group.key)).toEqual(['vixsrc']);
  });
});

describe('scopedFormats', () => {
  it('returns auto formats without a key and group formats with one', () => {
    const info = infoOf([groupOf('vixsrc', [1080, 720])]);
    expect(scopedFormats(info, null).map((format) => format.formatId)).toEqual([
      'vidrock-auto',
      'vidrock-1080p',
    ]);
    expect(scopedFormats(info, 'vixsrc').map((format) => format.formatId)).toEqual([
      'vixsrc-1080p',
      'vixsrc-720p',
    ]);
    expect(scopedFormats(info, 'missing')).toEqual(info.formats);
    expect(scopedFormats(null, 'vixsrc')).toEqual([]);
  });
});

describe('matchHeight', () => {
  it('keeps height across providers and falls back to first', () => {
    const formats = [formatOf('vixsrc-auto'), formatOf('vixsrc-1080p', 1080)];
    expect(matchHeight([], 1080)).toBeUndefined();
    expect(matchHeight(formats, undefined)?.formatId).toBe('vixsrc-auto');
    expect(matchHeight(formats, 1080)?.formatId).toBe('vixsrc-1080p');
    expect(matchHeight(formats, 2160)?.formatId).toBe('vixsrc-auto');
  });
});

describe('visibleFormats', () => {
  function dupes(): VideoInfo {
    const base = infoOf([]);
    return {
      ...base,
      formats: [
        formatOf('rock-auto-a'),
        formatOf('rock-auto-b'),
        formatOf('rock-1080p-a', 1080),
        formatOf('rock-1080p-b', 1080),
        formatOf('rock-720p', 720),
      ],
    };
  }

  it('collapses identical labels to one row each', () => {
    const ids = visibleFormats(dupes(), null, null).map((format) => format.formatId);
    expect(ids).toEqual(['rock-auto-a', 'rock-1080p-a', 'rock-720p']);
  });

  it('keeps the playing stream in place when it lost the race', () => {
    const ids = visibleFormats(dupes(), null, 'rock-1080p-b').map((format) => format.formatId);
    expect(ids).toEqual(['rock-auto-a', 'rock-1080p-b', 'rock-720p']);
  });
});
