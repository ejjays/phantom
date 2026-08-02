export const ID_REGEX =
  /(?:v=|fbid=|videos\/|reel\/|reels\/|share\/r\/|stories\/)([a-zA-Z0-9_-]+)/u;

export const STORY_PATTERNS = [
  /"unified_video_url"\s*:\s*"([^"]+)"/u,
  /"playable_url"\s*:\s*"([^"]+)"/u,
  /"playable_url_quality_hd"\s*:\s*"([^"]+)"/u,
];

export const PHOTO_PATTERNS = [
  /"media"\s*:\s*\{"__typename"\s*:\s*"Photo",.*?"image"\s*:\s*\{"uri"\s*:\s*"([^"]+)"\}/u,
  /"story_card_info"\s*:\s*\{.*?"story_thumbnail"\s*:\s*\{"uri"\s*:\s*"([^"]+)"\}/u,
  /"image"\s*:\s*\{"uri"\s*:\s*"([^"]+)"\}/u,
];

export const THUMB_PATTERNS = [
  /"preferred_thumbnail"\s*:\s*\{"image"\s*:\s*\{"uri"\s*:\s*"([^"]+)"\}/u,
  /"preview_image"\s*:\s*\{"uri"\s*:\s*"([^"]+)"\}/u,
];

export const DASH_PATTERNS = [
  /"browser_native_hd_url"\s*:\s*"([^"]+)"[^{}]*?"audioUrl"\s*:\s*"([^"]+)"/gu,
  /"audioUrl"\s*:\s*"([^"]+)"[^{}]*?"browser_native_hd_url"\s*:\s*"([^"]+)"/gu,
  /FBQualityClass=\\"hd\\"[^>]*?BaseURL>([^<]+)</gsu,
  /representation_id=\\"\d+v\\"[^>]*?base_url\\":\\"([^\\"]+)\\"/gsu,
];

export const HD_FALLBACK_PATTERNS = [
  /"browser_native_hd_url"\s*:\s*"([^"]+)"/u,
  /"playable_url_quality_hd"\s*:\s*"([^"]+)"/u,
  /hd_src\s*:\s*"([^"]+)"/u,
];

export const SD_FALLBACK_PATTERNS = [
  /"browser_native_sd_url"\s*:\s*"([^"]+)"/u,
  /"playable_url"\s*:\s*"([^"]+)"/u,
  /sd_src\s*:\s*"([^"]+)"/u,
  /"video_url"\s*:\s*"([^"]+)"/u,
];

export const RECOVERY_PATTERNS = [
  {
    type: 'author',
    pattern:
      /"(?:owner|author)":\{"__typename":"(?:User|Page)","name":"([^"]+)"/u,
  },
  {
    type: 'author',
    pattern: /"(?:story_bucket_owner_name|ownerName|author_name)":"([^"]+)"/u,
  },
  { type: 'author', pattern: /"story_bucket_owner":\{"name":"([^"]+)"/u },
  { type: 'author', pattern: /"owner_as_page":\{"name":"([^"]+)"/u },
  {
    type: 'author',
    pattern: /"comet_sections":\{"title":\{"text":"([^"]+)"\}/u,
  },
  { type: 'title', pattern: /"message":\s*\{"text":"([^"]+)"\}/u },
  { type: 'title', pattern: /"video_title":"([^"]+)"/u },
  { type: 'title', pattern: /"accessibility_caption":"([^"]+)"/u },
  {
    type: 'title',
    pattern:
      /"(?:message|node|accessibility_caption)":\s*\{"text":"([^"]+)"\}/u,
  },
];
