import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { fetchCredits } from '../src/extractors/watchluna/tmdb';

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
