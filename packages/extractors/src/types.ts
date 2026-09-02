export interface Format {
  formatId: string;
  url: string;
  extension: string;
  resolution?: string;
  quality?: string;
  width?: number;
  height?: number;
  tbr?: number;
  fps?: number | string;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
  isMuxed: boolean;
  isVideo: boolean;
  isAudio: boolean;
  note?: string;
  isHls?: boolean;
  hlsAudioUrl?: string;
  hlsKeepAlive?: boolean;
  muxAudioUrl?: string;
  muxAudioExt?: string;
  noTranscode?: boolean;
  audioDemux?: boolean;
}

export interface VideoInfo {
  type: 'video';
  id: string;
  title: string;
  uploader: string;
  webpageUrl: string;
  thumbnail?: string;
  duration?: number;
  author?: string;
  description?: string;
  metascraper?: Record<string, unknown>;
  formats: Format[];
  extractorKey?: string;
  isJsInfo: boolean;
  fromBrain: boolean;
  isPartial: boolean;
  isIsrcMatch: boolean;
  isFullData: boolean;
  downloadHeaders?: Record<string, string>;
  album?: string;
  source?: 'webview';
  previewUrl?: string | null;
  playlist?: {
    id: string;
    title: string;
    author?: string;
    authorAvatar?: string;
    entries: { id: string; title?: string; channel?: string; durationSec?: number; thumb?: string }[];
  };
}

export class ExtractorError extends Error {
  readonly retryable: boolean;
  readonly expected: boolean;
  constructor(message: string, retryable = true, expected = false) {
    super(message);
    this.name = 'ExtractorError';
    this.retryable = retryable;
    this.expected = expected;
  }
}

export interface ExtractorOptions {
  formatId?: string;
  downloadHeaders?: Record<string, string>;
  // x only: mark muxed mp4 as isAudio so mobile takes audio path
  isAudioMuxed?: boolean;
}

export interface Extractor {
  getInfo(url: string, options?: ExtractorOptions): Promise<VideoInfo | null>;
  getStream(
    videoInfo: VideoInfo,
    options?: ExtractorOptions
  ): Promise<ReadableStream>;
}