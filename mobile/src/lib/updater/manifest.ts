import { gatedFetch } from '../net';

export type UpdateManifest = {
  version: string;
  apkUrl: string;
  notes?: string;
  sha256?: string;
  minVersion?: string;
};

export function latestManifestUrl(): string {
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  return `${base}/storage/v1/object/public/apk/latest.json`;
}

export function parseManifest(text: string): UpdateManifest {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.version !== 'string' || typeof raw.apkUrl !== 'string') {
    throw new Error('bad update manifest');
  }
  const manifest: UpdateManifest = { version: raw.version, apkUrl: raw.apkUrl };
  if (typeof raw.notes === 'string') manifest.notes = raw.notes;
  if (typeof raw.sha256 === 'string') manifest.sha256 = raw.sha256;
  if (typeof raw.minVersion === 'string') manifest.minVersion = raw.minVersion;
  return manifest;
}

// '1.2.1' vs '1.3.0' -> negative when rhs is newer; integer parts only
export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((seg) => parseInt(seg, 10) || 0);
  const rightParts = right.split('.').map((seg) => parseInt(seg, 10) || 0);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < count; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export type UpdateCheck = {
  status: 'none' | 'available';
  manifest: UpdateManifest;
};

// 404 or unreachable means no release; a malformed manifest is a soft no
export async function checkForUpdate(
  installedVersion: string
): Promise<UpdateCheck | null> {
  try {
    const res = await gatedFetch(latestManifestUrl(), {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const manifest = parseManifest(await res.text());
    if (compareVersions(installedVersion, manifest.version) >= 0) return null;
    return { status: 'available', manifest };
  } catch {
    return null;
  }
}