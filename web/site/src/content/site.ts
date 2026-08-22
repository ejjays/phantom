export const APP_VERSION = '1.2.22';

export const REPO_URL = 'https://github.com/ejjays/phantom';
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;
export const SITE_URL = 'https://c-phantom.pages.dev';

export type Cap = 'yes' | 'no' | 'na';

export interface Caps {
  readonly video: Cap;
  readonly audio: Cap;
  readonly image: Cap;
}

export interface Platform {
  readonly id: string;
  readonly name: string;
  readonly caps: Caps;
}

// mirrors mobile SupportedPlatforms ROWS — keep both in sync when adding a platform
export const PLATFORMS: readonly Platform[] = [
  { id: 'youtube', name: 'YouTube', caps: { video: 'yes', audio: 'yes', image: 'na' } },
  { id: 'tiktok', name: 'TikTok', caps: { video: 'yes', audio: 'yes', image: 'yes' } },
  { id: 'instagram', name: 'Instagram', caps: { video: 'yes', audio: 'yes', image: 'yes' } },
  { id: 'x', name: 'X', caps: { video: 'yes', audio: 'yes', image: 'na' } },
  { id: 'facebook', name: 'Facebook', caps: { video: 'yes', audio: 'yes', image: 'yes' } },
  { id: 'threads', name: 'Threads', caps: { video: 'yes', audio: 'yes', image: 'yes' } },
  { id: 'bluesky', name: 'Bluesky', caps: { video: 'yes', audio: 'no', image: 'na' } },
  { id: 'reddit', name: 'Reddit', caps: { video: 'yes', audio: 'yes', image: 'na' } },
  { id: 'soundcloud', name: 'SoundCloud', caps: { video: 'na', audio: 'yes', image: 'na' } },
  { id: 'spotify', name: 'Spotify', caps: { video: 'yes', audio: 'yes', image: 'na' } },
  { id: 'vimeo', name: 'Vimeo', caps: { video: 'yes', audio: 'no', image: 'na' } },
  { id: 'bilibili', name: 'Bilibili', caps: { video: 'yes', audio: 'yes', image: 'na' } },
  { id: 'dailymotion', name: 'Dailymotion', caps: { video: 'yes', audio: 'no', image: 'na' } },
  { id: 'pinterest', name: 'Pinterest', caps: { video: 'yes', audio: 'yes', image: 'yes' } },
  { id: 'twitch', name: 'Twitch', caps: { video: 'yes', audio: 'no', image: 'na' } },
];

export const PLATFORM_NAMES = PLATFORMS.map((platform) => platform.name);

export const FEATURE_LIST = [
  'Your phone is the engine',
  '15 platforms, one paste box',
  'Full-bandwidth chunking',
  'Up to 8K — or just the audio',
  'Straight to your gallery',
  'Live progress, cancel anytime',
];

export const HOWTO_STEPS = [
  {
    name: 'Paste any link',
    text: 'YouTube, TikTok, Spotify, Reddit — Auto mode knows the site before you do.',
  },
  {
    name: 'Pick quality & format',
    text: '8K to 360p, full video or audio-only MP3 — sizes shown up front.',
  },
  {
    name: 'Saved to your gallery',
    text: 'Phantom muxes everything on-device and drops the file straight into Photos.',
  },
];

export interface Faq {
  readonly question: string;
  readonly answer: string;
}

export const FAQS: readonly Faq[] = [
  {
    question: 'Is Phantom really free?',
    answer:
      "Yes — 100%. No premium tier, no ads, no per-download caps. The whole pipeline runs on your own hardware, so there's no server bill to pass on to you.",
  },
  {
    question: 'Why an APK instead of the Play Store?',
    answer:
      "Phantom bundles a GPL ffmpeg build that store policies don't play nice with. Sideloading takes about a minute, and app updates ship silently over-the-air after that.",
  },
  {
    question: 'Does it need an account?',
    answer:
      'No. Downloading is completely anonymous. The community Updates feed is optional — sign in only if you want to react and comment.',
  },
  {
    question: 'Is anything tracked or uploaded?',
    answer:
      "Media never leaves your phone — there's no backend involved at all. Downloads run through your own IP, on your own hardware.",
  },
  {
    question: 'What can I download?',
    answer:
      'Videos up to 8K, audio as MP3/M4A, even HLS streams assembled locally. 15 dedicated platforms today, with more landing in every update.',
  },
];

export interface Screenshot {
  readonly id: string;
  readonly label: string;
  readonly caption: string;
}

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    id: 'home_screen',
    label: 'Home',
    caption: 'One box. Paste any link — Phantom figures out the rest.',
  },
  {
    id: 'video_download',
    label: 'Quality picker',
    caption: 'Up to 8K. Every format and size, before you commit.',
  },
  {
    id: 'audio_download',
    label: 'Audio mode',
    caption: 'Rip clean audio as MP3 or M4A, tagged automatically.',
  },
  {
    id: 'download_history',
    label: 'History',
    caption: 'Everything you grabbed, one tap to replay or share.',
  },
  {
    id: 'updates_feed',
    label: 'Updates',
    caption: 'A community feed for what ships next — react & comment.',
  },
  {
    id: 'settings_screen',
    label: 'Settings',
    caption: 'Themes, defaults and privacy — tuned your way.',
  },
];
