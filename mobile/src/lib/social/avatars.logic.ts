// preset cartoon avatars are stored in profiles.avatar_url as a `preset:<id>`
// marker (not a URL) so the existing string pipeline carries them everywhere;
// pure string helpers live here, away from image imports, to stay test-safe.

export const PRESET_PREFIX = 'preset:';

export function presetMarker(id: string): string {
  return `${PRESET_PREFIX}${id}`;
}

export function isPresetMarker(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PRESET_PREFIX);
}

export function presetIdOf(value: string | null | undefined): string | null {
  return isPresetMarker(value) ? value.slice(PRESET_PREFIX.length) : null;
}
