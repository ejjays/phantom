import { VideoInfo } from './types';

// identity fields required, rest defaulted — keeps isPartial => !isFullData
// invariant in one place so partial emitters can't drift out of sync.
type InfoInput = Partial<VideoInfo> &
  Pick<VideoInfo, 'id' | 'title' | 'uploader' | 'webpageUrl' | 'extractorKey'>;

export function buildVideoInfo(input: InfoInput): VideoInfo {
  const isPartial = input.isPartial ?? false;
  return {
    type: 'video',
    formats: [],
    thumbnail: undefined,
    duration: undefined,
    isJsInfo: true,
    fromBrain: false,
    isIsrcMatch: false,
    ...input,
    isPartial,
    isFullData: isPartial ? false : (input.isFullData ?? true),
  };
}
