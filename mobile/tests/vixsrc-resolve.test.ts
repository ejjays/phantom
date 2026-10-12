import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../src/lib/net';
import { fetchVixsrcFormats } from '../src/extractors/movies/providers/vixsrc';

vi.mock('../src/lib/net', () => ({
  fetchWithTimeout: vi.fn(),
}));
vi.mock('../src/lib/log', () => ({ log: () => undefined, error: () => undefined }));

const fetchMock = vi.mocked(fetchWithTimeout);

const api = JSON.stringify({
  src: '/embed/170060?token=57ea5ef60b97ca060cb7d3c422e79f50&t=RmlnaHQgQ2x1Yg%3D%3D&expires=1791782713&lang=en&skin=vixsrc&canPlayFHD=1',
});
const embed = `<html><body><script>window.masterPlaylist = { params: { 'token': '8c1e1b2369ef08568ac51565b44c6bfd', 'expires': '1796966712' }, url: 'https://vixsrc.to/playlist/170060' };</script></body></html>`;
const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",URI="https://vixsrc.to/playlist/170060?type=audio"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="eng",URI="https://vixsrc.to/playlist/170060?type=subtitle"
#EXT-X-STREAM-INF:BANDWIDTH=2150000,RESOLUTION=1280x720,AUDIO="audio",SUBTITLES="subs"
https://vixsrc.to/playlist/170060?type=video&rendition=720p&token=a
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,AUDIO="audio",SUBTITLES="subs"
https://vixsrc.to/playlist/170060?type=video&rendition=1080p&token=b
`;

function stubLeg() {
  fetchMock.mockImplementation((input: string) => {
    const url = String(input);
    const body = url.includes('/api/') ? api : url.includes('/embed/') ? embed : master;
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchVixsrcFormats', () => {
  it('maps movie rungs with auto first', async () => {
    stubLeg();
    const out = await fetchVixsrcFormats({ kind: 'movie', tmdbId: '550' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://vixsrc.to/api/movie/550');
    expect(out?.formats.map((format) => format.formatId)).toEqual([
      'vixsrc-auto',
      'vixsrc-1080p',
      'vixsrc-720p',
    ]);
    expect(out?.formats[0].hlsKeepAlive).toBe(true);
    expect(out?.headers.Referer).toBe('https://vixsrc.to/');
  });

  it('routes tv through the episode api', async () => {
    stubLeg();
    await fetchVixsrcFormats({ kind: 'tv', tmdbId: '1399', season: '1', episode: '1' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://vixsrc.to/api/tv/1399/1/1');
  });

  it.each([
    ['dry api', '{}', embed, master],
    ['dry embed', api, '<html></html>', master],
    ['dry master', api, embed, '#EXTM3U\n'],
  ])('returns null on %s', async (_label, apiBody, embedBody, masterBody) => {
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      const body = url.includes('/api/') ? apiBody : url.includes('/embed/') ? embedBody : masterBody;
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    await expect(fetchVixsrcFormats({ kind: 'movie', tmdbId: '550' })).resolves.toBeNull();
  });
});
