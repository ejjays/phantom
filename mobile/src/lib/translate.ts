import { log } from './log';

const GROQ_CHAT_API = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS_CHAT_API = 'https://api.cerebras.ai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const CEREBRAS_MODEL = 'gpt-oss-120b';

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
  return null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

let translateQueue: Promise<void> = Promise.resolve();

export function translateLines(
  texts: string[],
  fromCode: string,
  toCode: string,
  apiKey: string,
  fallbackKey?: string
): Promise<string[] | null> {
  if (texts.length === 0) return Promise.resolve([]);
  const task = translateQueue.then(async () => {
    const primary = await translateAttempt(texts, fromCode, toCode, apiKey);
    if (primary) return primary;
    if (fallbackKey && fallbackKey !== apiKey) {
      log('Translate', 'primary failed, trying fallback provider');
      return translateAttempt(texts, fromCode, toCode, fallbackKey);
    }
    return null;
  });
  translateQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function translateAttempt(
  texts: string[],
  fromCode: string,
  toCode: string,
  apiKey: string
): Promise<string[] | null> {
  const out: string[] = [];
  for (let at = 0; at < texts.length; at += 25) {
    if (at > 0) {
      await new Promise((done) => setTimeout(done, 300));
    }
    const part = await translateBatch(texts.slice(at, at + 25), fromCode, toCode, apiKey);
    if (!part) return null;
    out.push(...part);
  }
  return out;
}

async function translateBatch(
  texts: string[],
  fromCode: string,
  toCode: string,
  apiKey: string
): Promise<string[] | null> {
  const started = Date.now();
  const backoffs = [5000, 15000];
  const isCerebras = apiKey.startsWith('csk-');
  const endpoint = isCerebras ? CEREBRAS_CHAT_API : GROQ_CHAT_API;
  const model = isCerebras ? CEREBRAS_MODEL : GROQ_MODEL;
  const maxAbortMs = isCerebras ? 60000 : 20000;
  let mismatchRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const numbered = texts.map((text, i) => `${i + 1}. ${text}`).join('\n');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1024,
          messages: [
            {
              role: 'system',
              content: `You translate ${langName(fromCode)} TV subtitles to natural ${targetName(toCode)}. Return ONLY the translated lines, numbered exactly like the input, one per line. Never merge, split, drop, or explain lines.`,
            },
            { role: 'user', content: numbered },
          ],
        }),
      });
      if (res.status === 429 && attempt < backoffs.length) {
        const header = res.headers.get('retry-after');
        const hinted = header ? Math.round(Number(header) * 1000) : 0;
        if (hinted > maxAbortMs) {
          log('Translate', `rate limited (${Math.round(hinted / 1000)}s), aborting`);
          return null;
        }
        const wait = Math.min(hinted > 0 ? hinted : (backoffs[attempt] ?? 15000), maxAbortMs);
        log('Translate', `rate limited, retrying in ${Math.round(wait / 1000)}s`);
        await new Promise((done) => setTimeout(done, wait));
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        let snippet = '';
        try {
          snippet = String(await res.text()).slice(0, 160);
        } catch {
          snippet = '';
        }
        log('Translate', `http=${res.status} ms=${Date.now() - started} body=${snippet}`);
        return null;
      }
      const payload = (await res.json()) as unknown;
      const choices = rec(payload)?.['choices'];
      const first = Array.isArray(choices) ? rec(choices[0]) : null;
      const content = rec(first?.['message'])?.['content'];
      const parsed = parseNumberedLines(String(content ?? ''), texts.length);
      if (!parsed) {
        if (!mismatchRetried) {
          mismatchRetried = true;
          log('Translate', `line mismatch, retrying once (${texts.length} lines)`);
          continue;
        }
        const salvaged = parseNumberedLines(String(content ?? ''), texts.length, texts);
        if (salvaged) {
          log('Translate', `line mismatch salvaged with source (${texts.length} lines)`);
          return salvaged;
        }
        log('Translate', `line mismatch, keeping source (${texts.length} lines)`);
        return null;
      }
      log('Translate', `lines=${parsed.length} ms=${Date.now() - started}`);
      return parsed;
    } catch (err) {
      log('Translate', `threw ms=${Date.now() - started}: ${String(err)}`);
      return null;
    }
  }
}
