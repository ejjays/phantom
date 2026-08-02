import fs from 'node:fs';
import { logger } from './logger.util.js';
import path from 'node:path';
import { type Client } from '@libsql/client';
import { acquireSingletonLock } from './redis.util.js';

const fsp = fs.promises;
const HOUR_MS = 3600000;
const THREE_DAYS_MS = 3 * 24 * HOUR_MS;

// sweep this node's stale temp files
export async function cleanupLocalTemp(
  tempDir: string,
  maxAgeMs = HOUR_MS
): Promise<void> {
  let files: string[];
  try {
    files = await fsp.readdir(tempDir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(tempDir, file);
    try {
      const stats = await fsp.lstat(filePath);
      if (stats.isFile() && now - stats.mtimeMs > maxAgeMs) {
        await fsp.unlink(filePath).catch(() => {
          /* ignore */
        });
      }
    } catch {
      // ignore per-file errors
    }
  }
}

// delete expired remix rows + stem dirs
export async function cleanupRemixRegistry(
  db: Client | null,
  stemsBaseDir: string,
  maxAgeMs = THREE_DAYS_MS
): Promise<number> {
  if (!db) return 0;
  const cutoff = Date.now() - maxAgeMs;
  const expired = await db.execute({
    sql: 'SELECT id FROM remix_history WHERE created_at < ?',
    args: [cutoff],
  });
  for (const row of expired.rows) {
    const id = String(row.id);
    const dirPath = path.join(stemsBaseDir, id);
    if (fs.existsSync(dirPath)) {
      await fsp.rm(dirPath, { recursive: true, force: true }).catch(() => {
        /* ignore */
      });
    }
    await db.execute({
      sql: 'DELETE FROM remix_history WHERE id = ?',
      args: [id],
    });
    logger.info(`[Janitor] Cleaned up expired remix: ${id}`);
  }
  return expired.rows.length;
}

interface JanitorOpts {
  tempDir: string;
  stemsBaseDir: string;
  db: Client | null;
}

// local sweep + lock-gated shared sweep
export async function runJanitor(opts: JanitorOpts): Promise<void> {
  try {
    await cleanupLocalTemp(opts.tempDir);
    // one node sweeps shared registry
    if (await acquireSingletonLock('janitor:remix-registry', 3300)) {
      await cleanupRemixRegistry(opts.db, opts.stemsBaseDir);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[Janitor] tick error: ${message}`);
  }
}

// periodic housekeeping
export function startJanitor(opts: JanitorOpts): NodeJS.Timeout {
  const timer = setInterval(() => {
    runJanitor(opts).catch(() => {
      /* ignore */
    });
  }, HOUR_MS);
  timer.unref?.();
  return timer;
}
