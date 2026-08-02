export interface ThreadsRawFormat {
  url: string;
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
}

export interface ThreadsParsed {
  id: string | null;
  title: string;
  uploader: string;
  thumbnail: string;
  formats: ThreadsRawFormat[];
}
