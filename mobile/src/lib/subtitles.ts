import { gatedFetch } from './net';

export type SubtitleCue = { start: number; end: number; text: string };

export type SubtitleTrack = { label: string; lang: string; url: string };

const CUE =
  /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/u;

function toSeconds(hms: string, ms: string): number {
  const [hours, minutes, seconds] = hms.split(':').map(Number);
  return (
    (hours ?? 0) * 3600 +
    (minutes ?? 0) * 60 +
    (seconds ?? 0) +
    Number(ms.padEnd(3, '0')) / 1000
  );
}

export function parseVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\r?\n\r?\n/u)) {
    const lines = block.split(/\r?\n/u).filter((line) => line.trim() !== '');
    let timingIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (CUE.test(lines[i] ?? '')) {
        timingIndex = i;
        break;
      }
    }
    if (timingIndex < 0) continue;
    const match = CUE.exec(lines[timingIndex] ?? '');
    if (!match) continue;
    const body = lines
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/\{[^}]*\}/gu, '')
      .replace(/\\N/giu, '\n')
      .replace(/<[^>]*>/gu, '')
      .trim();
    if (!body) continue;
    cues.push({
      start: toSeconds(match[1] ?? '0:0:0', match[2] ?? '0'),
      end: toSeconds(match[3] ?? '0:0:0', match[4] ?? '0'),
      text: body,
    });
  }
  return cues;
}

export function formatVtt(cues: SubtitleCue[]): string {
  const stamp = (sec: number): string => {
    let ms = Math.round((sec - Math.floor(sec)) * 1000);
    const total = Math.floor(sec);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    let seconds = total % 60;
    if (ms >= 1000) {
      ms -= 1000;
      seconds += 1;
    }
    const pad = (value: number, size: number): string =>
      String(value).padStart(size, '0');
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms, 3)}`;
  };
  const out = ['WEBVTT', ''];
  for (const cue of cues) {
    out.push(`${stamp(cue.start)} --> ${stamp(cue.end)}`);
    out.push(cue.text, '');
  }
  return out.join('\n');
}

/**
 * Provider subtitles are timed against a different cut of the same film, so
 * captions creep earlier/later across the runtime. Rescaling the whole track
 * to end where the video ends fixes the drift; small mismatches are left alone
 * because nudging them invents a correction that isn't there.
 */
export function fitCuesToDuration(
  cues: SubtitleCue[],
  videoSec: number
): SubtitleCue[] {
  if (cues.length === 0 || videoSec <= 0) return cues;
  const trackEnd = cues.reduce((max, cue) => Math.max(max, cue.end), 0);
  if (trackEnd <= 0) return cues;
  const scale = videoSec / trackEnd;
  if (scale > 0.98 && scale < 1.02) return cues;
  const clamped = Math.min(Math.max(scale, 0.85), 1.18);
  return cues.map((cue) => ({
    start: Math.min(videoSec, cue.start * clamped),
    end: Math.min(videoSec, cue.end * clamped),
    text: cue.text,
  }));
}

export function cueAt(cues: SubtitleCue[], seconds: number): string | null {
  if (seconds < 0) return null;
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (!cue) break;
    if (seconds < cue.start) high = mid - 1;
    else if (seconds >= cue.end) low = mid + 1;
    else return cue.text;
  }
  return null;
}

const LANG_ALIASES: Record<string, string> = {
  english: 'en',
  eng: 'en',
  brazilian: 'pt',
  'brazilian portuguese': 'pt',
  portuguese: 'pt',
  spanish: 'es',
  castellano: 'es',
  'latin american spanish': 'es',
  french: 'fr',
  german: 'de',
  deutsch: 'de',
  italian: 'it',
  arabic: 'ar',
  hindi: 'hi',
  turkish: 'tr',
  turkce: 'tr',
  russian: 'ru',
  czech: 'cs',
  polish: 'pl',
  dutch: 'nl',
  indonesian: 'id',
  malay: 'ms',
  filipino: 'fil',
  tagalog: 'fil',
  bengali: 'bn',
  korean: 'ko',
  japanese: 'ja',
  chinese: 'zh',
  thai: 'th',
  vietnamese: 'vi',
  swahili: 'sw',
  ukrainian: 'uk',
};

export function langOfLabel(label: string): string {
  const base = label.toLowerCase().split(' - ')[0] ?? '';
  const trimmed = base.replace(/\d+$/u, '').trim();
  if (!trimmed) return 'und';
  const alias = LANG_ALIASES[trimmed];
  if (alias) return alias;
  const head = trimmed.split(/[\s-]+/u)[0] ?? trimmed;
  return LANG_ALIASES[head] ?? 'und';
}

/** provider tracks arrive in arbitrary order; prefer exact lang, then any track */
export function pickTrack(
  tracks: SubtitleTrack[],
  lang: string
): SubtitleTrack | null {
  if (tracks.length === 0) return null;
  const wanted = lang.toLowerCase();
  return (
    tracks.find((track) => track.lang === wanted) ??
    tracks.find((track) => langOfLabel(track.label) === wanted) ??
    null
  );
}

export type SpeechSeg = { start: number; end: number };

// merges word-level timestamps into speaking intervals so transcript output
// feeds the same overlap scorer as energy detection. pure, tested.
export function speechOfWords(
  words: Array<{ start: number; end: number }>,
  gapSec = 1
): SpeechSeg[] {
  const sorted = [...words]
    .filter((word) => word.end > word.start)
    .sort((lhs, rhs) => lhs.start - rhs.start);
  const out: SpeechSeg[] = [];
  for (const word of sorted) {
    const tail = out[out.length - 1];
    if (tail && word.start - tail.end <= gapSec) {
      tail.end = Math.max(tail.end, word.end);
    } else {
      out.push({ start: word.start, end: word.end });
    }
  }
  return out;
}
// groups transcript words into display cues: breaks on pauses or length so
// generated subs read like normal captions. pure, tested.
export function wordsToCues(
  words: Array<{ word: string; start: number; end: number }>,
  gapSec = 0.8,
  maxChars = 90
): SubtitleCue[] {
  const sorted = [...words]
    .filter((word) => word.end > word.start && word.word.trim().length > 0)
    .sort((lhs, rhs) => lhs.start - rhs.start);
  const out: SubtitleCue[] = [];
  let text = '';
  let start = 0;
  let end = 0;
  const flush = (): void => {
    if (text.length > 0) out.push({ start, end, text });
    text = '';
  };
  for (const word of sorted) {
    const token = word.word.trim();
    if (text.length === 0) {
      text = token;
      start = word.start;
      end = word.end;
      continue;
    }
    if (word.start - end > gapSec || `${text} ${token}`.length > maxChars) {
      flush();
      text = token;
      start = word.start;
      end = word.end;
      continue;
    }
    text += ` ${token}`;
    end = word.end;
  }
  flush();
  return out;
}

// shifts dialogue to sit on speech: scores every half-second offset in
// ±60s by overlapped cue seconds minus half the silence overlap, and only
// trusts a clear winner so sparse dialogue never invents timing
export function alignCuesToSpeech(
  cues: SubtitleCue[],
  speech: SpeechSeg[],
  videoSec: number,
  onDebug?: (info: {
    best: number;
    bestScore: number;
    zero: number;
    top: Array<{ offset: number; score: number }>;
  }) => void
): { offset: number; confidence: number } | null {
  if (cues.length === 0 || speech.length < 8) return null;
  const trackEnd = cues.reduce((max, cue) => Math.max(max, cue.end), 0);
  const speechEnd = speech.reduce((max, seg) => Math.max(max, seg.end), 0);
  const span = Math.max(videoSec, trackEnd, speechEnd, 1);
  const step = 0.5;
  const bins = Math.ceil(span / step);
  const base = 120;
  const cueMask = new Uint8Array(bins + base * 2 + 1);
  const mark = (from: number, to: number): void => {
    const lo = Math.max(0, Math.floor(from / step) + base);
    const hi = Math.min(cueMask.length - 1, Math.ceil(to / step) + base);
    for (let i = lo; i <= hi; i += 1) cueMask[i] = 1;
  };
  for (const cue of cues) mark(cue.start, cue.end);
  const speechMask = new Uint8Array(cueMask.length);
  for (const seg of speech) {
    const lo = Math.max(0, Math.floor(seg.start / step) + base);
    const hi = Math.min(
      speechMask.length - 1,
      Math.ceil(seg.end / step) + base
    );
    for (let i = lo; i <= hi; i += 1) speechMask[i] = 1;
  }
  let cueSecs = 0;
  for (let i = 0; i < cueMask.length; i += 1) cueSecs += cueMask[i];
  if (cueSecs === 0) return null;
  const score = (offset: number): number => {
    const shift = Math.round(offset / step);
    let hit = 0;
    let miss = 0;
    for (let i = 0; i < cueMask.length; i += 1) {
      if (!cueMask[i]) continue;
      if (speechMask[i + shift] === 1) hit += 1;
      else miss += 1;
    }
    return (hit - miss * 0.5) / cueSecs;
  };
  let best = 0;
  let bestScore = score(0);
  const ranked: Array<{ offset: number; score: number }> = [
    { offset: 0, score: bestScore },
  ];
  for (let offset = -60; offset <= 60; offset += step) {
    const value = score(offset);
    ranked.push({ offset, score: value });
    if (value > bestScore) {
      bestScore = value;
      best = offset;
    }
  }
  ranked.sort((lhs, rhs) => rhs.score - lhs.score);
  const top = ranked.slice(0, 3);
  if (Math.abs(best) < 0.75) return { offset: 0, confidence: bestScore };
  const margin = bestScore - score(0);
  if (bestScore < 0.25 || margin < 0.1) {
    onDebug?.({ best, bestScore, zero: score(0), top });
    return null;
  }
  return { offset: Math.round(best * 2) / 2, confidence: bestScore };
}

// turns ffmpeg silencedetect output into speaking intervals: complements
// closed silences inside the sample window so dialogue can be scored on it
export function speechOfSilence(
  logText: string,
  windowSec: number
): SpeechSeg[] {
  const quiet: SpeechSeg[] = [];
  let open: number | null = null;
  for (const line of logText.split('\n')) {
    const start = /silence_start: ([\d.]+)/u.exec(line)?.[1];
    if (start !== undefined) {
      open = Number(start);
      continue;
    }
    const end = /silence_end: ([\d.]+)/u.exec(line)?.[1];
    if (end !== undefined && open !== null) {
      quiet.push({ start: open, end: Number(end) });
      open = null;
    }
  }
  quiet.sort((lhs, rhs) => lhs.start - rhs.start);
  const speech: SpeechSeg[] = [];
  let cursor = 0;
  for (const gap of quiet) {
    if (gap.start > cursor) {
      speech.push({ start: cursor, end: Math.min(gap.start, windowSec) });
    }
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < windowSec) speech.push({ start: cursor, end: windowSec });
  return speech.filter((seg) => seg.end - seg.start > 0.1);
}

export async function fetchVttText(
  url: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const res = await gatedFetch(url, { headers });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes('-->') ? text : null;
  } catch {
    return null;
  }
}
