import { gatedFetch } from './net';

export type SubtitleCue = { start: number; end: number; text: string };

export type SubtitleTrack = { label: string; lang: string; url: string };

const CUE = /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/u;

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
export function fitCuesToDuration(cues: SubtitleCue[], videoSec: number): SubtitleCue[] {
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