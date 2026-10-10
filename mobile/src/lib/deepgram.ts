import ReactNativeBlobUtil from 'react-native-blob-util';
import { log } from './log';

const DG_API = 'https://api.deepgram.com/v1/listen';

export type DeepgramWord = { word: string; start: number; end: number };

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function deepgramWords(payload: unknown): DeepgramWord[] {
  const channels = rec(rec(payload)?.['results'])?.['channels'];
  const out: DeepgramWord[] = [];
  if (!Array.isArray(channels)) return out;
  for (const channel of channels) {
    const alternatives = rec(channel)?.['alternatives'];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) {
      const words = rec(alternative)?.['words'];
      if (!Array.isArray(words)) continue;
      for (const entry of words) {
        const item = rec(entry);
        const word = item?.['word'];
        const start = num(item?.['start']);
        const end = num(item?.['end']);
        if (typeof word !== 'string' || word.length === 0) continue;
        if (start === null || end === null || end <= start) continue;
        out.push({ word, start, end });
      }
    }
  }
  return out.sort((lhs, rhs) => lhs.start - rhs.start);
}

export async function transcribeFile(
  fsPath: string,
  mime: string,
  apiKey: string
): Promise<DeepgramWord[]> {
  const started = Date.now();
  try {
    const res = await ReactNativeBlobUtil.fetch(
      'POST',
      `${DG_API}?model=nova-3&smart_format=true&punctuate=true&detect_language=true`,
      { Authorization: `Token ${apiKey}`, 'Content-Type': mime },
      ReactNativeBlobUtil.wrap(fsPath)
    );
    const status = res.info().status;
    if (status < 200 || status >= 300) {
      log('Deepgram', `transcribe http=${status} ms=${Date.now() - started}`);
      return [];
    }
    const words = deepgramWords(await res.json());
    log(
      'Deepgram',
      `transcribed words=${words.length} ms=${Date.now() - started}`
    );
    return words;
  } catch {
    log('Deepgram', `transcribe threw ms=${Date.now() - started}`);
    return [];
  }
}
