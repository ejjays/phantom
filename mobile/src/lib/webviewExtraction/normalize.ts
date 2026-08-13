import { VideoInfo, Format } from '../../extractors/types';
import { DESKTOP_UA } from '../userAgents';
import { PageScan, dedupeVideos, extensionOf, hashUrl } from './sniffer';

function formatOf(video: PageScan['videos'][number], index: number): Format {
  const extension = extensionOf(video.url);
  const isHls = extension === 'm3u8';
  return {
    formatId: `${extension}_${index}`,
    url: video.url,
    extension: isHls ? 'mp4' : extension,
    quality: isHls ? 'HLS' : extension,
    isVideo: true,
    isAudio: false,
    isMuxed: true,
    isHls,
  };
}

// page scan → the app's VideoInfo; null when the page had no playable media
export function pageScanToVideoInfo(
  scan: PageScan,
  host: string,
  isPartial: boolean
): VideoInfo | null {
  // players park a placeholder <video> = page url until stream loads; direct
  // media pastes are exempt (their url is the file itself)
  const videos = dedupeVideos(scan.videos).filter(
    (video) => scan.isDirect || video.url !== scan.url
  );
  if (videos.length === 0) return null;

  const formats = videos
    .map((video, index) => formatOf(video, index))
    .sort((lhs, rhs) => Number(rhs.isHls) - Number(lhs.isHls));

  const thumbnail =
    videos.find((video) => video.poster)?.poster ??
    scan.ogImage ??
    scan.images[0]?.url;

  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    Referer: scan.url,
  };
  if (scan.cookies) headers.Cookie = scan.cookies;

  return {
    type: 'video',
    id: `page_${hashUrl(scan.url)}`,
    title: scan.title?.trim() || host,
    uploader: host,
    webpageUrl: scan.url,
    thumbnail,
    formats,
    extractorKey: 'webview',
    isJsInfo: true,
    fromBrain: false,
    isIsrcMatch: false,
    isFullData: !isPartial,
    isPartial,
    source: 'webview',
    downloadHeaders: headers,
  };
}
