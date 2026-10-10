import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
vi.mock('expo', () => ({ useEvent: vi.fn(() => null) }));
vi.mock('expo-video', () => ({ useVideoPlayer: vi.fn(() => null) }));
vi.mock('../src/extractors', () => ({ resolve: vi.fn() }));
vi.mock('../src/lib/net', () => ({
  gatedFetch: vi.fn(),
  mapLimit: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import type { AudioTrack } from 'expo-video';
import { pickEnglishAudio } from '../src/hooks/useMoviePlayer';

function track(language: unknown, label: string): AudioTrack {
  return { language, label } as unknown as AudioTrack;
}

describe('pickEnglishAudio', () => {
  it('skips tracks with a null language instead of crashing', () => {
    const tracks = [track(null, 'und'), track('eng', 'English')];
    expect(pickEnglishAudio(tracks)?.label).toBe('English');
  });

  it('returns null when no english track exists', () => {
    expect(pickEnglishAudio([track('spa', 'Spanish')])).toBeNull();
  });

  it('returns null for missing tracks', () => {
    expect(pickEnglishAudio(null)).toBeNull();
    expect(pickEnglishAudio(undefined)).toBeNull();
  });
});
