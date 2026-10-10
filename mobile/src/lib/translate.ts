import { log } from './log';

const GROQ_CHAT_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
};

export function langName(code: string): string {
  return LANG_NAMES[code] ?? 'the audio language';
}

// numbered-lines protocol: input and output are matched by number so a
// rephrasing model can never silently merge, split, or drop lines.
export function parseNumberedLines(text: string, count: number): string[] | null {
  const byNumber = new Map<number, string>();
  for (const raw of text.split('\n')) {
    const match = /^(\d+)[.)]\s?([\s\S]*)$/.exec(raw.trim());
    if (!match) continue;
    const line = (match[2] ?? '').trim();
    if (line.length === 0) continue;
    byNumber.set(Number(match[1]), line);
  }
  if (byNumber.size !== count) return null;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const line = byNumber.get(i);
    if (!line) return null;
    out.push(line);
  }
  return out;
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
  apiKey: string
): Promise<string[] | null> {
  if (texts.length === 0) return Promise.resolve([]);
  const task = translateQueue.then(() => translateAttempt(texts, fromCode, apiKey));
  translateQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function translateAttempt(
  texts: string[],
  fromCode: string,
  apiKey: string
): Promise<string[] | null> {
  const out: string[] = [];
  for (let at = 0; at < texts.length; at += 25) {
    const part = await translateBatch(texts.slice(at, at + 25), fromCode, apiKey);
    if (!part) return null;
    out.push(...part);
  }
  return out;
}

async function translateBatch(
  texts: string[],
  fromCode: string,
  apiKey: string
): Promise<string[] | null> {
  const started = Date.now();
  const backoffs = [5000, 15000];
  let mismatchRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const numbered = texts.map((text, i) => `${i + 1}. ${text}`).join('\n');
      const res = await fetch(GROQ_CHAT_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 8192,
          messages: [
            {
              role: 'system',
              content: `You translate ${langName(fromCode)} TV subtitles to natural English. Return ONLY the translated lines, numbered exactly like the input, one per line. Never merge, split, drop, or explain lines.`,
            },
            { role: 'user', content: numbered },
          ],
        }),
      });
      if (res.status === 429 && attempt < backoffs.length) {
        const header = res.headers.get('retry-after');
        const hinted = header ? Math.round(Number(header) * 1000) : 0;
        const wait = hinted > 0 ? hinted : (backoffs[attempt] ?? 15000);
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
