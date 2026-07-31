export interface FbRawFormat {
  url: string;
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
}

export interface FbParsed {
  id: string | null;
  title: string;
  uploader: string;
  thumbnail: string;
  formats: FbRawFormat[];
}
