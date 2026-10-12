import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Format } from '@phantom/extractors';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/extractors/movies/providers/vidrock', () => ({
  VIDROCK_HEADERS: {},
  fetchVidrockSources: vi.fn(),
  vidrockToFormats: vi.fn(),
}));

vi.mock('../src/extractors/movies/providers/vidlove', () => ({
  fetchVidloveFormats: vi.fn(),
}));

vi.mock('../src/extractors/movies/providers/vixsrc', () => ({
  fetchVixsrcFormats: vi.fn(),
}));

vi.mock('../src/extractors/movies/providers/vidzee', () => ({
  fetchVidzeeFormats: vi.fn(),
}));

vi.mock('../src/extractors/movies/providers/animeparadise', () => ({
  fetchParadiseFormats: vi.fn(),
}));

vi.mock('../src/extractors/movies/tmdb', () => ({
  fetchTmdbTitle: vi.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

function formatOf(formatId: string, height: number): Format {
  return {
    formatId,
    url: `https://cdn.example.com/${formatId}.m3u8`,
    extension: 'mp4',
    quality: `${height}p`,
    height,
    vcodec: 'h264',
    acodec: 'aac',
    isMuxed: true,
    isVideo: true,
    isAudio: false,
    isHls: true,
    note: 'test',
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});

async function setup() {
  const rock = await import('../src/extractors/movies/providers/vidrock');
  const love = await import('../src/extractors/movies/providers/vidlove');
  const vix = await import('../src/extractors/movies/providers/vixsrc');
  const zee = await import('../src/extractors/movies/providers/vidzee');
  const para = await import('../src/extractors/movies/providers/animeparadise');
  const tmdb = await import('../src/extractors/movies/tmdb');
  const health = await import('../src/lib/providerHealth');
  const { getInfo } = await import('../src/extractors/movies/index');
  vi.mocked(tmdb.fetchTmdbTitle).mockResolvedValue({
    title: 'T',
    genres: [],
    durationSec: 6000,
  });
  vi.mocked(vix.fetchVixsrcFormats).mockResolvedValue(null);
  vi.mocked(zee.fetchVidzeeFormats).mockResolvedValue(null);
  vi.mocked(para.fetchParadiseFormats).mockResolvedValue(null);
  return { rock, love, vix, health, getInfo };
}

describe('local down skip', () => {
  it('never fetches a leg marked down', async () => {
    const { rock, love, vix, health, getInfo } = await setup();
    vi.mocked(rock.fetchVidrockSources).mockResolvedValue([]);
    vi.mocked(vix.fetchVixsrcFormats).mockResolvedValue({
      formats: [formatOf('vixsrc-720p', 720)],
      headers: {},
    });
    vi.mocked(love.fetchVidloveFormats).mockResolvedValue({
      formats: [formatOf('vidlove-vidapi-1080p', 1080)],
      headers: {},
    });
    health.markLegDown('vidlove');
    const info = await getInfo('https://watchluna.gd/movie/1108427');
    expect(info?.formats[0]?.formatId).toBe('vixsrc-720p');
    expect(love.fetchVidloveFormats).not.toHaveBeenCalled();
  });

  it('marks a rejecting leg down and skips it next time', async () => {
    const { rock, love, health, getInfo } = await setup();
    vi.mocked(rock.fetchVidrockSources).mockRejectedValueOnce(new Error('vidrock 500'));
    vi.mocked(love.fetchVidloveFormats).mockResolvedValue({
      formats: [formatOf('vidlove-vidapi-720p', 720)],
      headers: {},
    });
    const first = await getInfo('https://watchluna.gd/movie/1108427');
    expect(first?.formats[0]?.formatId).toBe('vidlove-vidapi-720p');
    expect(health.localDown().has('vidrock')).toBe(true);
    vi.mocked(rock.fetchVidrockSources).mockRejectedValue(new Error('must not be called'));
    const second = await getInfo('https://watchluna.gd/movie/1108427');
    expect(second?.formats[0]?.formatId).toBe('vidlove-vidapi-720p');
    expect(rock.fetchVidrockSources).toHaveBeenCalledTimes(1);
  });

  it('ignores 4xx rejections', async () => {
    const { rock, love, health, getInfo } = await setup();
    vi.mocked(rock.fetchVidrockSources).mockRejectedValue(new Error('vidrock 403'));
    vi.mocked(love.fetchVidloveFormats).mockResolvedValue({
      formats: [formatOf('vidlove-vidapi-720p', 720)],
      headers: {},
    });
    await getInfo('https://watchluna.gd/movie/1108427');
    expect(health.localDown().has('vidrock')).toBe(false);
  });
});
