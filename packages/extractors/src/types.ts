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
  // 'hls m3u8' marker — getStream() routes via env.remuxHls
  note?: string;
  // mobile uses these; web ignores
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
  // ranged/segmented downloads need these
  downloadHeaders?: Record<string, string>;
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