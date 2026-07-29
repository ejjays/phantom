import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/extractors/youtube/bridge', () => ({
  extractViaWebView: vi.fn(),
  playlistViaWebView: vi.fn(),
}));

import { getInfo } from '../src/extractors/youtube';
import {
  playlistViaWebView,
  extractViaWebView,
} from '../src/extractors/youtube/bridge';
import type { RawYtPlaylist } from '../src/extractors/youtube/bridge';

const mockPlaylist = vi.mocked(playlistViaWebView);
const mockExtract = vi.mocked(extractViaWebView);

const SAMPLE_PLAYLIST: RawYtPlaylist = {
  id: 'PLTEST123',
  title: 'My Mix',
  author: 'SomeChannel',
  entries: [
    {
      id: 'aaaaaaaaaaa',
      title: 'First',
      channel: 'SomeChannel',
      durationSec: 200,
      thumb: 'https://i.ytimg.com/vi/a/hqdefault.jpg',
    },
    {
      id: 'bbbbbbbbbbb',
      title: 'Second',
      channel: 'SomeChannel',
      durationSec: 184,
      thumb: 'https://i.ytimg.com/vi/b/hqdefault.jpg',
    },
  ],
};

beforeEach(() => {
  mockPlaylist.mockReset();
  mockExtract.mockReset();
});

describe('youtube getInfo playlist routing', () => {
  it('returns a VideoInfo with .playlist when given a bare playlist URL', async () => {
    mockPlaylist.mockResolvedValue(SAMPLE_PLAYLIST);
    const info = await getInfo(
      'https://www.youtube.com/playlist?list=PLTEST123'
    );
    expect(mockPlaylist).toHaveBeenCalledWith('PLTEST123');
    expect(mockExtract).not.toHaveBeenCalled();
    expect(info).not.toBeNull();
    expect(info?.playlist).toBeDefined();
    expect(info?.playlist?.id).toBe('PLTEST123');
    expect(info?.playlist?.title).toBe('My Mix');
    expect(info?.playlist?.entries).toHaveLength(2);
    expect(info?.playlist?.entries[0].id).toBe('aaaaaaaaaaa');
    expect(info?.formats).toEqual([]);
    expect(info?.extractorKey).toBe('youtube');
  });

  it('throws typed ExtractorError when playlist has no entries', async () => {
    mockPlaylist.mockResolvedValue({
      id: 'PLEX',
      title: 'Empty',
      entries: [],
    });
    await expect(
      getInfo('https://www.youtube.com/playlist?list=PLEX')
    ).rejects.toThrow(/YouTube/iu);
  });

  it('throws typed ExtractorError when bridge returns null', async () => {
    mockPlaylist.mockResolvedValue(null);
    await expect(
      getInfo('https://www.youtube.com/playlist?list=PLFAIL')
    ).rejects.toThrow(/YouTube/iu);
  });

  it.each([
    'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLTEST123',
    'https://youtu.be/aaaaaaaaaaa?list=PLTEST123',
    'https://www.youtube.com/shorts/aaaaaaaaaaa',
  ])(
    'does NOT treat %s as a playlist (falls through to single-video path)',
    async (url) => {
      mockExtract.mockRejectedValue(new Error('extract not available in test'));
      await expect(getInfo(url)).rejects.toThrow();
      expect(mockPlaylist).not.toHaveBeenCalled();
    }
  );

  it('returns null for a URL with neither video id nor list', async () => {
    const info = await getInfo('https://www.youtube.com/feed/history');
    expect(info).toBeNull();
    expect(mockPlaylist).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
