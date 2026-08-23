import { File } from 'expo-file-system';
import { nativeDownload } from './nativeDownload';

export async function chunkedDownload(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  // native streams to disk via parallel 4MB regions; it also handles
  // range-less servers, unknown sizes, resume and 403 -> 'chunked: HTTP'
  // for the pipeline's refreshStreamUrl hook — no js fallback left
  await nativeDownload(url, headers, file, onProgress, signal);
}
