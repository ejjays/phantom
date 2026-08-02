import { z } from 'zod';

// image url schema
const MediaUrlSchema = z
  .string({ error: 'Media URL is required' })
  .min(1)
  .refine(
    (val: string) =>
      val.startsWith('/') || val.startsWith('http') || val.startsWith('data:'),
    { message: 'Must be a valid URL, data URI, or absolute path' }
  );

// core definitions
export const FormatSchema = z.object({
  formatId: z.string({ error: 'formatId is required' }).min(1),
  url: MediaUrlSchema,
  extension: z.string({ error: 'extension is required' }).min(1),
  resolution: z.string().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  filesize: z.number().int().nonnegative().optional(),
  isMuxed: z.boolean().default(false),
  isVideo: z.boolean().default(false),
  isAudio: z.boolean().default(false),
  audioUrl: z.string().url().optional(),
  fps: z.union([z.string(), z.number()]).optional(),
  quality: z.string().optional(),
  note: z.string().optional(),
  abr: z.number().nonnegative().optional(),
  tbr: z.number().nonnegative().optional(),
  itag: z.union([z.number(), z.string()]).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  language: z.string().optional(),
  languageName: z.string().optional(),
  isOriginal: z.boolean().optional(),
});

export const AudioFeaturesSchema = z.object({
  danceability: z.number(),
  energy: z.number(),
  key: z.number(),
  loudness: z.number(),
  mode: z.number(),
  speechiness: z.number(),
  acousticness: z.number(),
  instrumentalness: z.number(),
  liveness: z.number(),
  valence: z.number(),
  tempo: z.number(),
  duration_ms: z.number().int().optional(),
  time_signature: z.number().int().optional(),
});

// base metadata
export const BaseMediaDataSchema = z.object({
  id: z.string({ error: 'Media ID is required' }).min(1),
  title: z.string({ error: 'Title is required' }).min(1),
  cover: MediaUrlSchema.optional(),
  thumbnail: MediaUrlSchema.optional(),
  imageUrl: MediaUrlSchema.optional(),
  previewUrl: MediaUrlSchema.nullable().optional(),
  isrc: z.string().optional(),
  targetUrl: z.string().url().optional(),
  fromBrain: z.boolean().default(false),
  duration: z.number().nonnegative().optional(),
  isPartial: z.boolean().default(false),
  isIsrcMatch: z.boolean().default(false),
  isJsInfo: z.boolean().default(false),
});

// entity schemas
export const SpotifyMetadataSchema = BaseMediaDataSchema.extend({
  type: z.literal('spotify').default('spotify'),
  artist: z.string({ error: 'Artist is required' }).min(1),
  album: z.string().optional(),
  audioFeatures: AudioFeaturesSchema.optional(),
  year: z.string().optional(),
  source: z.string().optional(),
  formats: z.array(FormatSchema).optional(),
  audioFormats: z.array(FormatSchema).optional(),
});

export const VideoInfoSchema = BaseMediaDataSchema.extend({
  type: z.literal('video').default('video'),
  uploader: z.string({ error: 'Uploader is required' }).min(1),
  webpageUrl: z.string().url(),
  formats: z.array(FormatSchema).default([]),
  audioFormats: z.array(FormatSchema).optional(),
  audioFeatures: AudioFeaturesSchema.optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  extractorKey: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  viewCount: z.number().optional(),
  isFullData: z.boolean().default(false),
  originalInfo: z.string().optional(),
  metascraper: z.record(z.string(), z.unknown()).optional(),
  spotifyMetadata: SpotifyMetadataSchema.optional(),
});

// edge contract
export const FinalResponseSchema = z
  .object({
    id: z.string({ error: 'Media ID is required' }).min(1),
    title: z.string({ error: 'Title is required' }).min(1),
    artist: z.string({ error: 'Artist is required' }).min(1),
    uploader: z.string({ error: 'Uploader is required' }).min(1),
    album: z.string().default(''),
    cover: MediaUrlSchema,
    thumbnail: MediaUrlSchema,
    duration: z.number().nonnegative().optional(),
    previewUrl: MediaUrlSchema.nullable().optional(),
    formats: z.array(FormatSchema),
    audioFormats: z.array(FormatSchema),
    spotifyMetadata: SpotifyMetadataSchema.optional(),
    isPartial: z.boolean().default(false),
    isrc: z.string().optional(),
    isIsrcMatch: z.boolean().default(false),
    isJsInfo: z.boolean().default(false),
    webpageUrl: z.string().url().startsWith('http'),
  })
  .strict();

export type Format = z.infer<typeof FormatSchema>;
export type AudioFeatures = z.infer<typeof AudioFeaturesSchema>;
export type BaseMediaData = z.infer<typeof BaseMediaDataSchema>;
export type SpotifyMetadata = z.infer<typeof SpotifyMetadataSchema>;
export type VideoInfo = z.infer<typeof VideoInfoSchema>;
export type FinalResponse = z.infer<typeof FinalResponseSchema>;
