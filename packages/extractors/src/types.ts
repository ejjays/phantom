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
  // 'hls m3u8' — getStream() routes hls formats to env.remuxHls
  note?: string;
  // mobile-only flags (optional in web); consumers ignore what they don't use
  isHls?: boolean;
  hlsAudioUrl?: string;
  hlsKeepAlive?: boolean;
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
  // mobile-only: required headers for ranged/segmented downloads
  downloadHeaders?: Record<string, string>;
}

export interface ExtractorOptions {
  formatId?: string;
  // headers ranged downloads must send back to the cdn
  downloadHeaders?: Record<string, string>;
  // x only: mark muxed mp4 formats as isAudio so mobile picks the audio path
  isAudioMuxed?: boolean;
}

export interface Extractor {
  getInfo(url: string, options?: ExtractorOptions): Promise<VideoInfo | null>;
  getStream(
    videoInfo: VideoInfo,
    options?: ExtractorOptions
  ): Promise<ReadableStream>;
}