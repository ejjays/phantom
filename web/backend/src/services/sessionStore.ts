const TTL_MS = 30 * 60 * 1000;
const CLEAN_INTERVAL_MS = 5 * 60 * 1000;

interface EngineEntry {
  url: string;
  expiresAt: number;
}

const sessions = new Map<string, EngineEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function registerSession(sessionId: string, url: string): void {
  sessions.set(sessionId, { url, expiresAt: Date.now() + TTL_MS });
  ensureCleanupTimer();
}

export function getSessionUrl(sessionId: string): string | null {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return entry.url;
}

// Stems live on a user's remote engine, so a dead session is just a stale
// tunnel url — sweep it to keep the map from growing unbounded.
function purgeExpired(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now > entry.expiresAt) sessions.delete(id);
  }
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(purgeExpired, CLEAN_INTERVAL_MS);
  cleanupTimer.unref?.();
}