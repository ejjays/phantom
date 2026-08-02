export interface Format {
  formatId: string;
  url: string;
  extension: string;
  resolution?: string;
  quality?: string;
  width?: number;
  height?: number;
  tbr?: number;
  fps?: number;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
  isMuxed: boolean;
  isVideo: boolean;
  isAudio: boolean;
  // e.g. 'hls m3u8' — tells getStream() to use env.remuxHls
  note?: string;
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
}

export interface ExtractorOptions {
  formatId?: string;
}

export interface Extractor {
  getInfo(url: string, options?: ExtractorOptions): Promise<VideoInfo | null>;
  getStream(
    videoInfo: VideoInfo,
    options?: ExtractorOptions
  ): Promise<ReadableStream>;
}
