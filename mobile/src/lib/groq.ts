import { File } from 'expo-file-system';
import { log } from './log';
import type { DeepgramWord, TranscriptResult } from './deepgram';
import type { TranscribeLang } from './settings';
import type { SubtitleCue } from './subtitles';

const GROQ_API = 'https://api.groq.com/openai/v1/audio/transcriptions';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let cursor = 0;
  let bits = 0;
  let width = 0;
  for (const char of clean) {
    const sextet = B64.indexOf(char);
    if (sextet < 0) continue;
    bits = (bits << 6) | sextet;
    width += 6;
    if (width >= 8) {
      width -= 8;
      out[cursor] = (bits >> width) & 0xff;
      cursor += 1;
    }
  }
  return out.slice(0, cursor);
}

export function bytesToBase64(data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    text += String.fromCharCode(...data.slice(i, i + 0x8000));
  }
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const byteA = text.charCodeAt(i);
    const byteB = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    const byteC = i + 2 < text.length ? text.charCodeAt(i + 2) : 0;
    const triple = (byteA << 16) | (byteB << 8) | byteC;
    out +=
      B64[(triple >> 18) & 63] +
      B64[(triple >> 12) & 63] +
      (i + 1 < text.length ? B64[(triple >> 6) & 63] : '=') +
      (i + 2 < text.length ? B64[triple & 63] : '=');
  }
  return out;
}

export function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  filename: string,
  mime: string,
  fileBytes: Uint8Array
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    )
  );
  parts.push(fileBytes);
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  );
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }
  return body;
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pushWord(
  out: DeepgramWord[],
  word: unknown,
  start: unknown,
  end: unknown
): void {
  if (typeof word !== 'string' || word.trim().length === 0) return;
  const from = num(start);
  const to = num(end);
  if (from === null || to === null || to <= from) return;
  out.push({ word: word.trim(), start: from, end: to });
}

export function groqWords(payload: unknown): DeepgramWord[] {
  const root = rec(payload);
  const out: DeepgramWord[] = [];
  const words = root?.['words'];
  if (Array.isArray(words)) {
    for (const entry of words) {
      const item = rec(entry);
      pushWord(
        out,
        item?.['word'] ?? item?.['text'],
        item?.['start'],
        item?.['end']
      );
    }
    if (out.length > 0) return out.sort((lhs, rhs) => lhs.start - rhs.start);
  }
  const segments = root?.['segments'];
  if (Array.isArray(segments)) {
    for (const entry of segments) {
      const item = rec(entry);
      pushWord(out, item?.['text'], item?.['start'], item?.['end']);
    }
  }
  return out.sort((lhs, rhs) => lhs.start - rhs.start);
}

export function groqSegments(payload: unknown): SubtitleCue[] {
  const segments = rec(payload)?.['segments'];
  const out: SubtitleCue[] = [];
  if (!Array.isArray(segments)) return out;
  for (const entry of segments) {
    const item = rec(entry);
    const text = item?.['text'];
    const start = num(item?.['start']);
    const end = num(item?.['end']);
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    if (start === null || end === null || end <= start) continue;
    if (out.length > 0 && out[out.length - 1]?.text === text.trim()) continue;
    out.push({ start, end, text: text.trim() });
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
  const empty: TranscriptResult = { words: [], cues: [] };
  try {
    log('Groq', `upload uri=${fsPath}`);
    const audio = new File(fsPath);
    const fileBytes = (
      audio as unknown as { bytesSync(): Uint8Array }
    ).bytesSync();
    if (fileBytes.length === 0) {
      log('Groq', 'sample unreadable');
      return empty;
    }
    const boundary = `phantom${Date.now().toString(36)}`;
    const body = buildMultipartBody(
      boundary,
      {
        model: 'whisper-large-v3-turbo',
        response_format: 'verbose_json',
        ...(lang === 'auto' ? {} : { language: lang }),
      },
      'sample.mp3',
      mime,
      fileBytes
    );
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body as unknown as BodyInit,
    });
    const status = res.status;
    if (status < 200 || status >= 300) {
      log('Groq', `transcribe http=${status} ms=${Date.now() - started}`);
      return empty;
    }
    const payload = (await res.json()) as unknown;
    const words = groqWords(payload);
    const cues = groqSegments(payload);
    log(
      'Groq',
      `transcribed words=${words.length} segments=${cues.length} ms=${Date.now() - started}`
    );
    return { words, cues };
  } catch (err) {
    log('Groq', `transcribe threw ms=${Date.now() - started}: ${String(err)}`);
    return empty;
  }
}
