// required by instagram private api
export const IG_APP_ID = '936619743392459';

// graphql doc id for post query
export const POST_DOC_ID = '8845758582119845';

// logged-out post query — IG gates old shortcode graphql behind auth now,
// so resolve via /api/graphql with media_id (pk) variant instead
export const LOGGED_OUT_DOC_ID = '27130156389949648';
export const LOGGED_OUT_FRIENDLY =
  'PolarisLoggedOutDesktopWWWPostRootContentQuery';

// base-64 alphabet mapping shortcode -> numeric media pk
export const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// android app ua for mobile api
export const MOBILE_UA =
  'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)';

// app-id unlocks logged-out web json
export const WEB_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  'x-ig-app-id': IG_APP_ID,
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
};

export const MOBILE_HEADERS: Record<string, string> = {
  'User-Agent': MOBILE_UA,
  'x-ig-app-id': IG_APP_ID,
  'x-ig-app-locale': 'en_US',
  'x-ig-device-locale': 'en_US',
  'x-ig-mapped-locale': 'en_US',
  'Accept-Language': 'en-US',
  'x-fb-http-engine': 'Liger',
};

export const EMBED_HEADERS: Record<string, string> = {
  'User-Agent': DESKTOP_UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
