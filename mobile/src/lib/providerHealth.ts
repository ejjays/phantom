import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCAL_DOWN_COOLDOWN_MS = 30 * 60 * 1000;
const LOCAL_DOWN_KEY = 'phantom.providers.localDown';

let local: Record<string, number> = {};

function validLocal(value: unknown): value is Record<string, number> {
  const rec = value as Record<string, unknown> | null;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
  return Object.values(rec).every((at) => typeof at === 'number');
}

void AsyncStorage.getItem(LOCAL_DOWN_KEY)
  .then((raw) => {
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (validLocal(parsed)) local = parsed;
  })
  .catch(() => undefined);

function persistLocal(): void {
  void AsyncStorage.setItem(LOCAL_DOWN_KEY, JSON.stringify(local)).catch(
    () => undefined
  );
}

export function markLegDown(name: string): void {
  local[name] = Date.now();
  persistLocal();
}

export function markLegUp(name: string): void {
  if (name in local) {
    delete local[name];
    persistLocal();
  }
}

export function localDown(now: number = Date.now()): Set<string> {
  const out = new Set<string>();
  let dirty = false;
  for (const [name, at] of Object.entries(local)) {
    if (now - at < LOCAL_DOWN_COOLDOWN_MS) out.add(name);
    else {
      delete local[name];
      dirty = true;
    }
  }
  if (dirty) persistLocal();
  return out;
}

const LEG_PREFIXES = ['vidrock', 'vidlove', 'vixsrc', 'vidzee', 'paradise'];

export function legOfFormatId(
  formatId: string | null | undefined
): string | null {
  if (!formatId) return null;
  for (const name of LEG_PREFIXES) {
    if (formatId.startsWith(`${name}-`)) return name;
  }
  return null;
}

export function isTransportDown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/(?:^|\s)(\d{3})(?:$|[^0-9])/)?.[1];
  return !code?.startsWith('4');
}
