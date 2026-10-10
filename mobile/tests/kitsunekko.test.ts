import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/net', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../src/lib/net';

const mockedFetch = vi.mocked(fetchWithTimeout);

const INDEX_HTML =
  '<a href="/dirlist.php?dir=subtitles%2FDragon+Ball+Super%2F" class=""><strong>Dragon Ball Super</strong></a>' +
  '<a href="/dirlist.php?dir=subtitles%2FSolo+leveling+%2F" class=""><strong>Solo leveling </strong></a>';

const DRAGON_FOLDER_HTML =
  '<a href="subtitles/Dragon Ball Super/Dragon Ball Super - 01.srt" class="">x</a>' +
  '<a href="subtitles/Dragon Ball Super/Dragon Ball Super - 10.srt" class="">x</a>' +
  '<a href="subtitles/Dragon Ball Super/Dragon Ball Super - 100.srt" class="">x</a>' +
  '<a href="subtitles/Dragon Ball Super/Dragon Ball Super - 11.srt" class="">x</a>' +
  '<a href="subtitles/Dragon Ball Super/Dragon Ball Super pack.zip" class="">x</a>';

const SOLO_FOLDER_HTML =
  '<a href="subtitles/Solo leveling /Solo Leveling - 01.srt" class="">x</a>';

function okHtmlOnce(html: string) {
  mockedFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(html),
  } as Response);
}

function freshModule() {
  vi.resetModules();
  return import('../src/extractors/movies/kitsunekko');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchKitsunekkoSubtitles', () => {
  it('matches the episode file without catching 10 or 100', async () => {
    const { fetchKitsunekkoSubtitles } = await freshModule();
    okHtmlOnce(INDEX_HTML);
    okHtmlOnce(DRAGON_FOLDER_HTML);
    const tracks = await fetchKitsunekkoSubtitles('Dragon Ball Super', '1');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].url).toBe(
      'https://kitsunekko.net/subtitles/Dragon%20Ball%20Super/Dragon%20Ball%20Super%20-%2001.srt'
    );
    expect(tracks[0].lang).toBe('en');
  });

  it('matches case-insensitively with trailing spaces', async () => {
    const { fetchKitsunekkoSubtitles } = await freshModule();
    okHtmlOnce(INDEX_HTML);
    okHtmlOnce(SOLO_FOLDER_HTML);
    const tracks = await fetchKitsunekkoSubtitles('Solo Leveling', '1');
    expect(tracks).toHaveLength(1);
  });

  it('returns empty when the show is missing', async () => {
    const { fetchKitsunekkoSubtitles } = await freshModule();
    okHtmlOnce(INDEX_HTML);
    const tracks = await fetchKitsunekkoSubtitles('Breaking Bad', '1');
    expect(tracks).toEqual([]);
  });

  it('returns empty for non-numeric episodes', async () => {
    const { fetchKitsunekkoSubtitles } = await freshModule();
    const tracks = await fetchKitsunekkoSubtitles('Dragon Ball Super', 'S1');
    expect(tracks).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
