import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { fetchCredits, fetchTmdbTitle } from '../src/extractors/movies/tmdb';

const mockedFetch = vi.mocked(gatedFetch);

function creditsPayload() {
  return {
    cast: [
      { name: 'Ada Cole', profile_path: '/ada.jpg' },
      { name: 'Bo Ray', profile_path: null },
    ],
    crew: [
      { job: 'Director', name: 'Cy Finn', profile_path: '/cy.jpg' },
      { job: 'Writer', name: 'Dee Guy', profile_path: '/dee.jpg' },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
});

describe('fetchCredits', () => {
  it('maps cast photos and the director', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(creditsPayload()),
    } as Response);
    const credits = await fetchCredits('movie', '1001');
    expect(credits?.cast).toEqual([
      { name: 'Ada Cole', photo: 'https://image.tmdb.org/t/p/w185/ada.jpg' },
      { name: 'Bo Ray' },
    ]);
    expect(credits?.director).toEqual({
      name: 'Cy Finn',
      photo: 'https://image.tmdb.org/t/p/w185/cy.jpg',
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null without an api key', async () => {
    delete process.env.EXPO_PUBLIC_TMDB_API_KEY;
    const credits = await fetchCredits('tv', '2002');
    expect(credits).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('caches repeat lookups', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(creditsPayload()),
    } as Response);
    await fetchCredits('movie', '3003');
    await fetchCredits('movie', '3003');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchTmdbTitle', () => {
  it('maps movie details', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Ada Ascends',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        release_date: '2026-04-01',
        vote_average: 7.5,
        vote_count: 120,
        genres: [{ name: 'Drama' }, { name: 42 }],
        overview: 'Rise and shine.',
        runtime: 145,
      }),
    } as Response);
    const title = await fetchTmdbTitle('movie', '4004');
    expect(title).toMatchObject({
      title: 'Ada Ascends',
      image: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      backdrop: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
      year: '2026',
      rating: 7.5,
      votes: 120,
      genres: ['Drama'],
      description: 'Rise and shine.',
      durationSec: 8700,
    });
  });

  it('maps tv details with episode runtime', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        name: 'Bo Show',
        first_air_date: '2020-01-01',
        vote_average: 8,
        genres: [],
        episode_run_time: [45],
      }),
    } as Response);
    const title = await fetchTmdbTitle('tv', '5005');
    expect(title).toMatchObject({
      title: 'Bo Show',
      year: '2020',
      rating: 8,
      durationSec: 2700,
    });
  });

  it('returns null without a title', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ overview: 'No name.' }),
    } as Response);
    await expect(fetchTmdbTitle('movie', '6006')).resolves.toBeNull();
  });
});
