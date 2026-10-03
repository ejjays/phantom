import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
}));

import { gatedFetch } from '../src/lib/net';
import { vidrockToFormats } from '../src/extractors/watchluna/vidrock';
import {
  searchTitles,
  parseCards,
  listRail,
  listTrending,
  getTitleDetails,
} from '../src/extractors/watchluna/browse';

const mockFetch = vi.mocked(gatedFetch);

function textRes(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) } as unknown as Response;
}

function jsonRes(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

function playlistRes(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

const MOVIE_CARD = `<a href="/movie/969681" class="card">
<div class="card-img"><img src="https://image.tmdb.org/t/p/w342/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg" alt="Watch Spider-Man: Brand New Day (2026) online free in HD" width="342" height="513" loading="lazy"><span class="card-badge badge-hd">HD</span></div>
<div class="card-info"><h3 class="text-white truncate">Spider-Man: Brand New Day</h3>
<div class="flex items-center gap-2 mt-1 text-xs flex-wrap"><span class="text-zinc-500">2026</span><span>Movie</span></div>
</div></a>`;

const TV_CARD = `<a href="/tv/2287" class="card">
<div class="card-img"><img src="https://image.tmdb.org/t/p/w342/1ZEJuuDh0Zpi5ELM3Zev0GBhQ3R.jpg" alt="Watch Batman (1966) online free in HD" width="342" height="513" loading="lazy"><span class="card-badge badge-hd">HD</span></div>
<div class="card-info"><h3 class="text-white truncate">Batman</h3>
<div class="flex items-center gap-2 mt-1 text-xs flex-wrap"><span class="text-zinc-500">1966</span><span>TV</span></div>
</div></a>`;

const RAIL_HTML = `<h1>Popular Movies</h1><p class="text-zinc-400">Page 1 of 500</p>${MOVIE_CARD}${TV_CARD}`;

const TRENDING_HTML = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Trending Movies & TV Shows This Week","numberOfItems":2,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://watchluna.gd/movie/1248832","name":"Digger","image":"https://image.tmdb.org/t/p/w342/1ATXKrIPJyKNwnJ6lcG088Sa6zi.jpg"},{"@type":"ListItem","position":2,"url":"https://watchluna.gd/tv/2287","name":"Batman","image":"https://image.tmdb.org/t/p/w342/1ZEJuuDh0Zpi5ELM3Zev0GBhQ3R.jpg"}]}</script>`;

const DETAIL_HTML = `<!doctype html><html><head><title>Watch The Batman (2022) Online Free | Watchluna</title>
<link rel="preload" as="image" href="https://image.tmdb.org/t/p/w1280/rvtdN5XkWAfGX6xDuPL6yYS2seK.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"The Batman","description":"In his second year of fighting crime","datePublished":"2022-03-01","image":"https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg","aggregateRating":{"@type":"AggregateRating","ratingValue":7.7,"bestRating":10,"worstRating":0,"ratingCount":12593},"genre":["Crime","Mystery","Thriller"],"duration":"PT177M","contentRating":"PG-13","director":{"@type":"Person","name":"Matt Reeves"},"actor":[{"@type":"Person","name":"Robert Pattinson"},{"@type":"Person","name":"Zoë Kravitz"}]}</script>
</head><body></body></html>`;

describe('searchTitles', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('maps movie + tv hits with posters and years', async () => {
    mockFetch.mockResolvedValue(
      jsonRes({
        results: [
          {
            id: 414906,
            media_type: 'movie',
            title: 'The Batman',
            release_date: '2022-03-01',
            poster_path: '/74xTEgt7R36Fpooo50r9T25onhq.jpg',
            vote_average: 7.67,
          },
          {
            id: 2287,
            media_type: 'tv',
            title: 'Batman',
            release_date: '1966-01-12',
            poster_path: '/1ZEJuuDh0Zpi5ELM3Zev0GBhQ3R.jpg',
            vote_average: 7.287,
          },
        ],
      })
    );
    const items = await searchTitles('batman');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: '414906',
      kind: 'movie',
      title: 'The Batman',
      year: '2022',
      poster: 'https://image.tmdb.org/t/p/w342/74xTEgt7R36Fpooo50r9T25onhq.jpg',
    });
    expect(items[0].rating).toBeCloseTo(7.67);
    expect(items[1]).toMatchObject({ id: '2287', kind: 'tv', year: '1966' });
  });

  it.each([[''], [' '], ['a']])('returns [] without fetching for %s', async (term) => {
    const items = await searchTitles(term);
    expect(items).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns [] when the api shape is unexpected', async () => {
    mockFetch.mockResolvedValue(jsonRes({ results: null }));
    await expect(searchTitles('batman')).resolves.toEqual([]);
  });

  it('skips entries missing id or title', async () => {
    mockFetch.mockResolvedValue(jsonRes({ results: [{ id: 1 }, { title: 'x' }] }));
    await expect(searchTitles('batman')).resolves.toEqual([]);
  });
});

describe('parseCards', () => {
  it('parses movie + tv cards from rail html', () => {
    expect(parseCards(RAIL_HTML)).toEqual([
      {
        kind: 'movie',
        id: '969681',
        poster: 'https://image.tmdb.org/t/p/w342/bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg',
        title: 'Spider-Man: Brand New Day',
        year: '2026',
      },
      {
        kind: 'tv',
        id: '2287',
        poster: 'https://image.tmdb.org/t/p/w342/1ZEJuuDh0Zpi5ELM3Zev0GBhQ3R.jpg',
        title: 'Batman',
        year: '1966',
      },
    ]);
  });

  it('returns [] for pages without cards', () => {
    expect(parseCards('<html><body>nope</body></html>')).toEqual([]);
  });
});

describe('listRail', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns items with pagination', async () => {
    mockFetch.mockResolvedValue(textRes(RAIL_HTML));
    const rail = await listRail('/movies', 1, 'Popular');
    expect(rail?.title).toBe('Popular');
    expect(rail?.items).toHaveLength(2);
    expect(rail?.totalPages).toBe(500);
  });

  it('returns null when no origin serves cards', async () => {
    mockFetch.mockResolvedValue(textRes('<html></html>'));
    await expect(listRail('/movies')).resolves.toBeNull();
  });

  it('joins page with & when the path already has a query', async () => {
    mockFetch.mockResolvedValue(textRes(RAIL_HTML));
    await listRail('/movies?sort=top_rated', 2, 'Top');
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/movies?sort=top_rated&page=2'
    );
  });
});

describe('listTrending', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('reads the trending ItemList', async () => {
    mockFetch.mockResolvedValue(textRes(TRENDING_HTML));
    const items = await listTrending();
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: 'movie', id: '1248832', title: 'Digger' });
    expect(items?.[1]).toMatchObject({ kind: 'tv', id: '2287', title: 'Batman' });
  });
});

describe('getTitleDetails', () => {  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('builds the full detail panel', async () => {
    mockFetch.mockResolvedValue(textRes(DETAIL_HTML));
    const details = await getTitleDetails('movie', '414906');
    expect(details).toMatchObject({
      id: '414906',
      kind: 'movie',
      title: 'The Batman',
      year: '2022',
      rating: 7.7,
      votes: 12593,
      genres: ['Crime', 'Mystery', 'Thriller'],
      contentRating: 'PG-13',
      director: 'Matt Reeves',
      backdrop: 'https://image.tmdb.org/t/p/w1280/rvtdN5XkWAfGX6xDuPL6yYS2seK.jpg',
    });
    expect(details?.cast).toEqual(['Robert Pattinson', 'Zoë Kravitz']);
    expect(details?.durationSec).toBe(10620);
    expect(details?.description).toContain('second year');
  });

  it('returns null when every origin fails', async () => {
    mockFetch.mockRejectedValue(new Error('down'));
    await expect(getTitleDetails('movie', '414906')).resolves.toBeNull();
  });
});

const QUICK_MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'https://cdn.example/1080.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  'https://cdn.example/720.m3u8',
].join('\n');

describe('vidrockToFormats quick mode', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('lists variants without touching segments', async () => {
    mockFetch.mockImplementation((reqUrl: unknown) => {
      const target = String(reqUrl);
      if (target.includes('roguefrequency.live')) return Promise.resolve(playlistRes(QUICK_MASTER));
      return Promise.resolve(textRes('', false));
    });
    const formats = await vidrockToFormats(
      [{ name: 'Orion', url: 'https://roguefrequency.live/master.m3u8', streamType: 'hls' }],
      7380,
      { quick: true }
    );
    expect(formats).toHaveLength(2);
    expect(formats[0].formatId).toContain('orion-1080p');
    expect(formats[0].filesize).toBeGreaterThan(0);
    const touchedSegments = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('cdn.example') || String(call[0]).includes('seg.example')
    );
    expect(touchedSegments).toHaveLength(0);
  });
});
