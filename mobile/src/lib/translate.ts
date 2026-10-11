import { log } from './log';
import { timeoutSignal } from './net';

const GROQ_CHAT_API = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS_CHAT_API = 'https://api.cerebras.ai/v1/chat/completions';
const GROQ_MODEL = 'qwen/qwen3.8-27b';
const CEREBRAS_MODEL = 'qwen-3.8-27b';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
};

const TARGET_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
};

export function targetName(code: string): string {
  return TARGET_NAMES[code] ?? 'English';
}

export function langName(code: string): string {
  return LANG_NAMES[code] ?? 'the audio language';
}

// numbered-lines protocol: input and output are matched by number so a
// rephrasing model can never silently merge, split, or drop lines.
export function parseNumberedLines(
  text: string,
  count: number,
  fallback?: string[]
): string[] | null {
  const byNumber = new Map<number, string>();
  for (const raw of text.split('\n')) {
    const match = /^[[(]?(?:\*{1,2})?(\d+)(?:\*{1,2})?\s*[\]):.-](?:\*{1,2})?\s*([\s\S]*)$/.exec(
      raw.trim()
    );
    if (!match) continue;
    const line = (match[2] ?? '').trim().replace(/^["']|["']$/g, '').trim();
    if (line.length === 0) continue;
    byNumber.set(Number(match[1]), line);
  }
  if (byNumber.size === count) {
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
      const line = byNumber.get(i);
      if (!line) return null;
      out.push(line);
    }
    return out;
  }
  if (fallback && fallback.length === count && byNumber.size >= Math.max(1, Math.ceil(count * 0.6))) {
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
      out.push(byNumber.get(i) ?? fallback[i - 1] ?? '');
    }
    return out;
  }
  if (count > 1 && byNumber.size === 0) {
    const plain = text
      .split('\n')
      .map((raw) =>
        raw
          .trim()
          .replace(/^[-*•]\s+/, '')
          .replace(/^["']|["']$/g, '')
          .trim()
      )
      .filter((raw) => raw.length > 0 && !raw.startsWith('```'));
    if (plain.length === count) return plain;
  }
  return null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

let inflight = 0;
const MAX_INFLIGHT = 2;
const waiters: Array<() => void> = [];

function acquireSemaphore(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      inflight += 1;
      resolve();
    });
  });
}

function releaseSemaphore(): void {
  inflight -= 1;
  const next = waiters.shift();
  next?.();
}

let roundRobinIndex = 0;

export function translateLines(
  texts: string[],
  fromCode: string,
  toCode: string,
  apiKey: string | string[],
  fallbackKey?: string | string[]
): Promise<string[] | null> {
  if (texts.length === 0) return Promise.resolve([]);
  const primaryKeys = (Array.isArray(apiKey) ? apiKey : [apiKey]).filter(Boolean);
  const fallbackKeys = (Array.isArray(fallbackKey) ? fallbackKey : fallbackKey ? [fallbackKey] : []).filter(Boolean);
  return (async () => {
    await acquireSemaphore();
    try {
      const primary = await translateAttempt(texts, fromCode, toCode, primaryKeys);
      if (primary) return primary;
      if (fallbackKeys.length > 0) {
        log('Translate', 'primary failed, trying fallback provider');
        return translateAttempt(texts, fromCode, toCode, fallbackKeys);
      }
      return null;
    } finally {
      releaseSemaphore();
    }
  })();
}

async function translateAttempt(
  texts: string[],
  fromCode: string,
  toCode: string,
  keys: string[]
): Promise<string[] | null> {
  if (keys.length === 0) return null;
  const out: string[] = [];
  for (let at = 0; at < texts.length; at += 25) {
    if (at > 0) {
      await new Promise((done) => setTimeout(done, 300));
    }
    const part = await translateBatch(texts.slice(at, at + 25), fromCode, toCode, keys);
    if (!part) return null;
    out.push(...part);
  }
  return out;
}

async function handleRateLimit(
  res: Response,
  attempt: number,
  maxAbortMs: number
): Promise<boolean> {
  const header = res.headers.get('retry-after');
  const hinted = header ? Math.round(Number(header) * 1000) : 0;
  if (hinted > maxAbortMs || attempt >= 1) {
    log('Translate', `rate limited (${Math.round(hinted / 1000)}s), aborting`);
    return false;
  }
  const wait = Math.min(hinted > 0 ? hinted : 5000, maxAbortMs);
  log('Translate', `rate limited, retrying in ${Math.round(wait / 1000)}s`);
  await new Promise((done) => setTimeout(done, wait));
  return true;
}

function parseChatCompletion(
  payload: unknown,
  count: number,
  fallbackTexts: string[]
): string[] | null {
  const choices = rec(payload)?.['choices'];
  const first = Array.isArray(choices) ? rec(choices[0]) : null;
  const content = rec(first?.['message'])?.['content'];
  const raw = String(content ?? '');
  const parsed = parseNumberedLines(raw, count);
  if (parsed) return parsed;
  const salvaged = parseNumberedLines(raw, count, fallbackTexts);
  if (salvaged) {
    log('Translate', `line mismatch salvaged with source (${count} lines)`);
    return salvaged;
  }
  log('Translate', `line mismatch (${count} lines)`);
  return null;
}

async function translateBatch(
  texts: string[],
  fromCode: string,
  toCode: string,
  keys: string[]
): Promise<string[] | null> {
  const started = Date.now();
  const maxAttempts = Math.max(2, keys.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = keys[(roundRobinIndex + attempt) % keys.length] ?? '';
    if (!key) return null;
    const isCerebras = key.startsWith('csk-');
    const endpoint = isCerebras ? CEREBRAS_CHAT_API : GROQ_CHAT_API;
    const model = isCerebras ? CEREBRAS_MODEL : GROQ_MODEL;
    // abort quickly on Groq (10s) so fallback can take over; Cerebras gets 60s
    const maxAbortMs = isCerebras ? 60000 : 10000;
    try {
      const numbered = texts.map((text, i) => `${i + 1}. ${text}`).join('\n');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        signal: timeoutSignal(maxAbortMs),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1024,
          messages: [
            {
              role: 'system',
              content: `You translate ${langName(fromCode)} TV subtitles to natural ${targetName(toCode)}. Return ONLY the translated lines, numbered exactly like the input, one per line. Never merge, split, drop, or explain lines. No intro or commentary.\nExample input:\n1. 안녕하세요\n2. 네\nExample output:\n1. Hello\n2. Yes`,
            },
            { role: 'user', content: numbered },
          ],
        }),
      });
      if (res.status === 429) {
        if (keys.length > 1 && attempt < keys.length - 1) {
          log('Translate', 'pool key rate limited, switching to next key');
          continue;
        }
        const ok = await handleRateLimit(res, attempt, maxAbortMs);
        if (!ok) return null;
        continue;
      }
      if (!res.ok) {
        const snippet = await res.text().catch(() => '').then((t) => t.slice(0, 160));
        log('Translate', `http=${res.status} ms=${Date.now() - started} body=${snippet}`);
        if (keys.length > 1 && attempt < keys.length - 1) continue;
        return null;
      }
      const parsed = parseChatCompletion(await res.json(), texts.length, texts);
      if (!parsed) {
        if (keys.length > 1 && attempt < keys.length - 1) continue;
        return null;
      }
      roundRobinIndex = (roundRobinIndex + attempt + 1) % keys.length;
      log('Translate', `lines=${parsed.length} ms=${Date.now() - started}`);
      return parsed;
    } catch (err) {
      log('Translate', `threw ms=${Date.now() - started}: ${String(err)}`);
      if (keys.length > 1 && attempt < keys.length - 1) continue;
      return null;
    }
  }
  return null;
}

