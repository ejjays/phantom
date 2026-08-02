import fpcalc from 'fpcalc';
import * as Sentry from '@sentry/node'; // skipcq: JS-C1003
// lazy load to reduce boot RAM
import { getUgChords } from './ug-grounding.service.js';
import { z } from 'zod';
import { secureFetch } from '../utils/network/security.util.js';

const ACOUSTID_API_KEY = process.env.ACOUSTID_API_KEY ?? '';

const AcoustidResponseSchema = z
  .object({
    results: z
      .array(
        z.object({
          recordings: z
            .array(
              z.object({
                id: z.string(),
              })
            )
            .optional(),
        })
      )
      .optional(),
  })
  .catchall(z.unknown());

const MusicBrainzResponseSchema = z
  .object({
    isrcs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

const DeezerResponseSchema = z
  .object({
    error: z
      .object({
        type: z.string(),
        message: z.string(),
        code: z.number(),
      })
      .optional(),
    artist: z.object({ name: z.string() }).optional(),
    title: z.string().optional(),
  })
  .catchall(z.unknown());

type LyricsData = {
  plainLyrics?: string;
  syncedLyrics?: string;
  [key: string]: unknown;
};

type SongData = {
  artist: string;
  title: string;
  isrc: string | null;
  lyrics: string | null;
  chordsSheet: string | null;
  chordsLink: string;
  grounded: boolean;
};

async function getGeminiChords(
  artist: string,
  title: string,
  syncedLyrics: string | null,
  engineChords: { is_passing: boolean; time: number; chord: string }[]
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VERTEX_API_KEY;
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import('@google/genai');

    interface IGoogleGenAI {
      getGenerativeModel: (options: { model: string }) => {
        generateContent: (prompt: string) => Promise<{
          response: { text: () => string };
        }>;
      };
    }

    type IGoogleGenAIConstructor = new (key: string) => IGoogleGenAI;

    const GenAIClass = GoogleGenAI as unknown as IGoogleGenAIConstructor;
    const genAIInstance = new GenAIClass(apiKey);

    let prompt = `Act as an expert music transcriber. Your task is to merge raw audio-extracted chords with synchronized lyrics to create a highly accurate Ultimate-Guitar style chord sheet.\n\nSong: "${title}" by "${artist}"\n\n`;

    if (syncedLyrics && engineChords?.length > 0) {
      prompt += `Here are the timestamped lyrics (in [mm:ss.xx] format):\n${syncedLyrics}\n\n`;

      const chordsSummary = engineChords
        .filter((chord) => !chord.is_passing)
        .map((chord) => `[${formatTime(chord.time)}] ${chord.chord}`)
        .join('\n');

      prompt += `Here are the exact chords detected in the audio by our engine at specific timestamps:\n${chordsSummary}\n\n`;
      prompt +=
        'CRITICAL INSTRUCTIONS:\n1. You MUST format this EXACTLY like an Ultimate Guitar text file.\n2. Chords MUST be placed on their own dedicated line directly ABOVE the lyrics, NOT inline with the text.\n3. Example of correct formatting:\n[ch]C[/ch]                  [ch]G[/ch]\nLet it be, let it be\n4. You MUST wrap every single chord in [ch] brackets (e.g., [ch]Am7[/ch]).\n5. Use the timestamps provided to figure out exactly which word the chord falls on, and space the chords out on the top line accordingly.\n6. Ignore long repetitive blocks of chords at the end (outros) if there are no lyrics. Keep it clean.\n7. ONLY output the final formatted chord sheet text. No markdown blocks, no conversational text.';
    } else {
      prompt +=
        'Since exact audio data is missing, return the most highly-rated guitar chords and lyrics available for this song. \nCRITICAL: Chords MUST be placed on their own line directly ABOVE the lyrics. Wrap every single chord in [ch] brackets (e.g., [ch]Am7[/ch]).\nProvide ONLY the song text with chords. No markdown code blocks or extra text.';
    }

    const model = genAIInstance.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text || null;
  } catch (error: unknown) {
    const errorObj = error as Error;
    console.error('Gemini Chords Error:', errorObj.message);
    Sentry.captureException(error);
    return null;
  }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(2);
  return `${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds.padStart(5, '0')}`;
}

async function getLyrics(
  artist: string,
  title: string
): Promise<LyricsData | null> {
  const cleanTitle = title.split(/[([]/u)[0].trim();

  const fetchExact = async (trackName: string): Promise<LyricsData | null> => {
    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(trackName)}`;
      const response = await secureFetch(url);
      if (!response.ok) return null;
      const json = (await response.json()) as LyricsData;
      return json;
    } catch (error) {
      console.debug('[ExtractService] lyrics fetch exact failed:', error);
      return null;
    }
  };

  const fetchSearch = async (trackName: string): Promise<LyricsData | null> => {
    try {
      const query = encodeURIComponent(`${artist} ${trackName}`);
      const url = `https://lrclib.net/api/search?q=${query}`;
      const response = await secureFetch(url);
      if (!response.ok) return null;
      const data = (await response.json()) as LyricsData[];
      if (data.length > 0) {
        return (
          data.find(
            (result) =>
              result.plainLyrics !== undefined ||
              result.syncedLyrics !== undefined
          ) || null
        );
      }
    } catch (error) {
      console.debug('[ExtractService] lyrics fetch search failed:', error);
      return null;
    }
    return null;
  };

  let data = await fetchExact(title);
  if (data) return data;
  if (title !== cleanTitle) {
    data = await fetchExact(cleanTitle);
    if (data) return data;
  }
  data = await fetchSearch(title);
  if (data) return data;
  if (title !== cleanTitle) {
    data = await fetchSearch(cleanTitle);
    if (data) return data;
  }
  return null;
}

async function processSong(
  artist: string,
  title: string,
  isrc: string | null,
  engineChords: Array<{ chord: string; is_passing: boolean; time?: number }>
): Promise<SongData> {
  const lrclibData = await getLyrics(artist, title);
  const plainLyrics = lrclibData?.plainLyrics || null;
  const syncedLyrics = lrclibData?.syncedLyrics || null;

  const groundingRes = await getUgChords(artist, title);
  let chordsSheet = groundingRes?.chordsSheet || null;
  const usedGrounding = Boolean(chordsSheet);

  if (!chordsSheet) {
    const validChords = engineChords.filter(
      (chord): chord is { chord: string; is_passing: boolean; time: number } =>
        typeof chord.time === 'number'
    );
    chordsSheet = await getGeminiChords(
      artist,
      title,
      syncedLyrics,
      validChords
    );
  }

  const cleanTitle = title.split('(')[0].trim();
  const query = `${artist} ${cleanTitle}`;
  const ugLink = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`;

  return {
    artist,
    title,
    isrc: isrc || null,
    lyrics: plainLyrics,
    chordsSheet,
    chordsLink: ugLink,
    grounded: usedGrounding,
  };
}

async function fallbackToShazam(
  filePath: string,
  engineChords: Array<{ chord: string; is_passing: boolean }>
): Promise<SongData> {
  try {
    const { Shazam } = await import('node-shazam');
    const shazam = new Shazam();
    const response = (await shazam.recognise(filePath, 'en-US')) as {
      track?: { subtitle: string; title: string; isrc: string };
    };
    if (response?.track) {
      const track = response.track;

      const artist = track.subtitle;
      const title = track.title;
      const isrc = track.isrc;
      if (artist && title)
        return await processSong(artist, title, isrc, engineChords);
    }
    throw new Error('Shazam failed');
  } catch (error: unknown) {
    const err = error as Error;
    throw new Error(`Shazam error: ${err.message}`, { cause: error });
  }
}

export function extractSongData(
  filePath: string,
  engineChords: Array<{ chord: string; is_passing: boolean }> = []
): Promise<SongData> {
  return new Promise((resolve, reject) => {
    const shazamFallback = () => fallbackToShazam(filePath, engineChords);
    fpcalc(
      filePath,
      async (
        error: Error | null,
        result: { fingerprint: string; duration: number } | undefined
      ) => {
        if (error || !result) {
          try {
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          } catch (fallbackErr) {
            reject(fallbackErr);
            return;
          }
        }

        const acoustidUrl = `https://api.acoustid.org/v2/lookup?client=${ACOUSTID_API_KEY}&meta=recordingids&fingerprint=${result.fingerprint}&duration=${result.duration}`;

        try {
          const response = await secureFetch(acoustidUrl);
          const rawAcoustidData = await response.json();
          const parsedAcoustid =
            AcoustidResponseSchema.safeParse(rawAcoustidData);
          if (!parsedAcoustid.success) {
            console.debug(
              '[ExtractService] Acoustid validation failed:',
              parsedAcoustid.error.message
            );
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }
          const data = parsedAcoustid.data;
          const recording = data.results?.[0]?.recordings?.[0];

          if (!recording) {
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }

          const mbid = recording.id;
          const mbUrl = `https://musicbrainz.org/ws/2/recording/${mbid}?inc=isrcs&fmt=json`;
          const mbRes = await secureFetch(mbUrl, {
            headers: { 'User-Agent': 'ISRC_Finder/1.0' },
          });
          const rawMbData = await mbRes.json();
          const parsedMb = MusicBrainzResponseSchema.safeParse(rawMbData);
          if (!parsedMb.success) {
            console.debug(
              '[ExtractService] MusicBrainz validation failed:',
              parsedMb.error.message
            );
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }
          const mbData = parsedMb.data;
          const isrc = mbData.isrcs?.[0];

          if (!isrc) {
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }

          const deezerRes = await secureFetch(
            `https://api.deezer.com/track/isrc:${isrc}`
          );
          const rawDeezerData = await deezerRes.json();
          const parsedDeezer = DeezerResponseSchema.safeParse(rawDeezerData);
          if (!parsedDeezer.success) {
            console.debug(
              '[ExtractService] Deezer validation failed:',
              parsedDeezer.error.message
            );
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }
          const deezerData = parsedDeezer.data;
          if (deezerData.error || !deezerData.artist || !deezerData.title) {
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          }

          const finalResult = await processSong(
            deezerData.artist.name,
            deezerData.title,
            isrc,
            engineChords
          );
          resolve(finalResult);
          return;
        } catch (error) {
          console.debug(
            '[ExtractService] Acoustid match failed, falling back:',
            error
          );
          try {
            const fallbackResult = await shazamFallback();
            resolve(fallbackResult);
            return;
          } catch (fallbackErr) {
            reject(fallbackErr);
            return;
          }
        }
      }
    );
  });
}
