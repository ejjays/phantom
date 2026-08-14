export interface Format {
  formatId: string;
  url: string;
  extension: string;
  resolution?: string;
  quality?: string;
  width?: number;
  height?: number;
  tbr?: number;
  acodec?: string;
  vcodec?: string;
  isAudio: boolean;
  isVideo: boolean;
  isMuxed: boolean;
  filesize?: number;
  muxAudioUrl?: string;
  muxAudioExt?: string;
  isHls?: boolean;
  hlsAudioUrl?: string;
  hlsKeepAlive?: boolean;
  noTranscode?: boolean;
  audioDemux?: boolean;
}

export interface PlaylistEntry {
  id: string;
  title?: string;
  channel?: string;
  durationSec?: number;
  thumb?: string;
}

export interface VideoInfo {
  type: 'video';
  id: string;
  title: string;
  uploader: string;
  album?: string;
  webpageUrl: string;
  thumbnail?: string;
  duration?: number;
  formats: Format[];
  extractorKey: string;
  isJsInfo: boolean;
  fromBrain: boolean;
  isPartial: boolean;
  isIsrcMatch: boolean;
  isFullData: boolean;
  source?: 'webview';
  metascraper?: { title?: string };
  downloadHeaders?: Record<string, string>;
  previewUrl?: string;
  playlist?: {
    id: string;
    title: string;
    author?: string;
    authorAvatar?: string;
    entries: PlaylistEntry[];
  };
}

export interface ExtractorOptions {
  formatId?: string;
  cookie?: string;
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
