import { File } from 'expo-file-system';
import { log } from './log';
import type { TranscribeLang } from './settings';
import type { SubtitleCue } from './subtitles';

const DG_API = 'https://api.deepgram.com/v1/listen';

export type DeepgramWord = { word: string; start: number; end: number };

export type TranscriptResult = { words: DeepgramWord[]; cues: UtteranceCue[]; lang: string };

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
  out.sort((lhs, rhs) => lhs.start - rhs.start);
  // diarization can emit overlapping words — clamp to monotonic
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const curr = out[i];
    if (prev && curr) {
      if (curr.start < prev.start) curr.start = prev.start;
      if (curr.end <= curr.start) curr.end = curr.start + 0.1;
    }
  }
  return out;
}

export type UtteranceCue = SubtitleCue & { speaker: number };

function speakerOf(item: Record<string, unknown> | null): number {
  const speaker = item?.['speaker'];
  return typeof speaker === 'number' && Number.isFinite(speaker) ? Math.floor(speaker) : -1;
}

export function deepgramLang(payload: unknown): string {
  const channels = rec(rec(payload)?.['results'])?.['channels'];
  if (!Array.isArray(channels)) return '';
  const first = rec(channels[0]);
  const alternatives = first?.['alternatives'];
  if (!Array.isArray(alternatives)) return '';
  const languages = rec(alternatives[0])?.['languages'];
  if (!Array.isArray(languages)) return '';
  const lang = languages[0];
  return typeof lang === 'string' ? lang.toLowerCase().slice(0, 2) : '';
}

export function deepgramConfidence(payload: unknown): number {
  const channels = rec(rec(payload)?.['results'])?.['channels'];
  if (!Array.isArray(channels)) return -1;
  let total = 0;
  let count = 0;
  for (const channel of channels) {
    const alternatives = rec(channel)?.['alternatives'];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) {
      const words = rec(alternative)?.['words'];
      if (!Array.isArray(words)) continue;
      for (const entry of words) {
        const confidence = num(rec(entry)?.['confidence']);
        if (confidence === null) continue;
        total += confidence;
        count += 1;
      }
    }
  }
  return count === 0 ? -1 : total / count;
}

export function deepgramUtterances(payload: unknown): UtteranceCue[] {
  const utterances = rec(rec(payload)?.['results'])?.['utterances'];
  const out: UtteranceCue[] = [];
  if (!Array.isArray(utterances)) return out;
  for (const entry of utterances) {
    const item = rec(entry);
    const text = item?.['transcript'];
    const start = num(item?.['start']);
    const end = num(item?.['end']);
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    if (start === null || end === null || end <= start) continue;
    out.push({ start, end, text: text.trim(), speaker: speakerOf(item) });
  }
  return out.sort((lhs, rhs) => lhs.start - rhs.start);
}

export async function transcribeFile(
  fsPath: string,
  mime: string,
  apiKey: string,
  lang: TranscribeLang
): Promise<TranscriptResult> {
  const started = Date.now();
  const empty: TranscriptResult = { words: [], cues: [], lang: '' };
  try {
    const data = (new File(fsPath) as unknown as { bytesSync(): Uint8Array }).bytesSync();
    if (data.length === 0) {
      log('Deepgram', 'sample unreadable');
      return empty;
    }
    const langParam = lang === 'auto' ? 'detect_language=true' : `language=${lang}`;
    const res = await fetch(
      `${DG_API}?model=nova-3&smart_format=true&punctuate=true&${langParam}&utterances=true&filler_words=true&numerals=true&paragraphs=true&diarize_model=latest`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mime },
        body: data as unknown as BodyInit,
      }
    );
    const status = res.status;
    if (status < 200 || status >= 300) {
      let snippet = '';
      try {
        snippet = String(await res.text()).slice(0, 160);
      } catch {
        snippet = '';
      }
      log('Deepgram', `transcribe http=${status} ms=${Date.now() - started} body=${snippet}`);
      return empty;
    }
    const payload = (await res.json()) as unknown;
    const words = deepgramWords(payload);
    const cues = deepgramUtterances(payload);
    const detected = deepgramLang(payload);
    const confidence = deepgramConfidence(payload);
    log(
      'Deepgram',
      `transcribed words=${words.length} utterances=${cues.length} lang=${detected} conf=${confidence < 0 ? 'n/a' : confidence.toFixed(2)} ms=${Date.now() - started}`
    );
    return { words, cues, lang: detected };
  } catch (err) {
    log('Deepgram', `transcribe threw ms=${Date.now() - started}: ${String(err)}`);
    return empty;
  }
}
