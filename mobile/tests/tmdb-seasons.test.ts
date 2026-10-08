import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { fetchTvSeasons, fetchSeasonEpisodes } from '../src/extractors/movies/tmdb';

const mockedFetch = vi.mocked(gatedFetch);

function seasonsPayload() {
  return {
    seasons: [
      { season_number: 0, name: 'Specials', episode_count: 3 },
      { season_number: 1, name: 'Season 1', episode_count: 12 },
      { season_number: 2, name: '', episode_count: 0 },
      { name: 'Nope' },
    ],
  };
}

function episodesPayload() {
  return {
    episodes: [
      {
        episode_number: 1,
        name: 'The Job',
        overview: 'A crew wakes up.',
        still_path: '/still1.jpg',
      },
      { episode_number: 2, name: '', overview: '', still_path: null },
    ],
  };
}

function okOnce(payload: unknown) {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
});

describe('fetchTvSeasons', () => {
  it('maps seasons with fallbacks', async () => {
    okOnce(seasonsPayload());
    const seasons = await fetchTvSeasons('445');
    expect(seasons).toEqual([
      { number: 0, name: 'Specials', episodeCount: 3 },
      { number: 1, name: 'Season 1', episodeCount: 12 },
      { number: 2, name: 'Season 2', episodeCount: 0 },
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('returns empty without an api key', async () => {
    delete process.env.EXPO_PUBLIC_TMDB_API_KEY;
    expect(await fetchTvSeasons('447')).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('caches repeat lookups', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(seasonsPayload()),
    } as Response);
    await fetchTvSeasons('446');
    await fetchTvSeasons('446');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchSeasonEpisodes', () => {
  it('maps episodes with fallbacks', async () => {
    okOnce(episodesPayload());
    const episodes = await fetchSeasonEpisodes('445', 1);
    expect(episodes).toEqual([
      {
        number: 1,
        name: 'The Job',
        overview: 'A crew wakes up.',
        still: 'https://image.tmdb.org/t/p/w300/still1.jpg',
      },
      { number: 2, name: 'Episode 2' },
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('returns empty without an api key', async () => {
    delete process.env.EXPO_PUBLIC_TMDB_API_KEY;
    expect(await fetchSeasonEpisodes('448', 1)).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
