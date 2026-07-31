import { describe, it, expect } from 'vitest';
import {
  PRESET_PREFIX,
  presetMarker,
  isPresetMarker,
  presetIdOf,
} from '../src/lib/avatars.logic';
import { randomPresetMarker, AVATAR_CATEGORIES } from '../src/lib/avatars';

describe('avatar preset markers', () => {
  it('round-trips an id through marker and back', () => {
    expect(presetMarker('07')).toBe('preset:07');
    expect(presetIdOf(presetMarker('07'))).toBe('07');
  });

  it('detects preset markers vs real urls and empties', () => {
    expect(isPresetMarker('preset:01')).toBe(true);
    expect(isPresetMarker('https://example.com/a.jpg')).toBe(false);
    expect(isPresetMarker('')).toBe(false);
    expect(isPresetMarker(null)).toBe(false);
    expect(isPresetMarker(undefined)).toBe(false);
  });

  it('returns null id for non-preset values', () => {
    expect(presetIdOf('https://example.com/a.jpg')).toBeNull();
    expect(presetIdOf(null)).toBeNull();
    expect(presetIdOf(undefined)).toBeNull();
  });

  it('exposes the marker prefix', () => {
    expect(PRESET_PREFIX).toBe('preset:');
  });
});

describe('randomPresetMarker', () => {
  const ids = AVATAR_CATEGORIES.flatMap((cat) =>
    cat.avatars.map((avatar) => avatar.id)
  );

  it('returns a marker for a real preset id', () => {
    for (let i = 0; i < 50; i++) {
      const marker = randomPresetMarker();
      expect(marker.startsWith('preset:')).toBe(true);
      expect(ids).toContain(presetIdOf(marker));
    }
  });
});
