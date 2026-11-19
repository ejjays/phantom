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
  readonly note?: string;
}

// mirrors mobile SupportedPlatforms ROWS — keep both in sync when adding a platform
export const PLATFORMS: readonly Platform[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
    note: 'playlists, shorts, up to 8K',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    caps: { video: 'yes', audio: 'yes', image: 'yes' },
    note: 'videos + photo carousels',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    caps: { video: 'yes', audio: 'yes', image: 'yes' },
    note: 'reels, posts, multi-image picker',
  },
  {
    id: 'x',
    name: 'X',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
    note: 'videos & gifs only',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    caps: { video: 'yes', audio: 'yes', image: 'yes' },
    note: 'public posts only',
  },
  {
    id: 'threads',
    name: 'Threads',
    caps: { video: 'yes', audio: 'yes', image: 'yes' },
  },
  {
    id: 'bluesky',
    name: 'Bluesky',
    caps: { video: 'yes', audio: 'no', image: 'na' },
    note: 'hls streams — no mp3 yet',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    caps: { video: 'na', audio: 'yes', image: 'na' },
    note: 'audio-only platform',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
    note: 'tracks & albums found automatically',
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    caps: { video: 'yes', audio: 'no', image: 'na' },
    note: 'hls streams — no mp3 yet',
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
    note: 'some videos need a cookie',
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    caps: { video: 'yes', audio: 'no', image: 'na' },
    note: 'hls streams — no mp3 yet',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    caps: { video: 'yes', audio: 'yes', image: 'yes' },
    note: 'video pins + photos',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    caps: { video: 'yes', audio: 'no', image: 'na' },
    note: 'clips, hls only',
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    caps: { video: 'yes', audio: 'yes', image: 'na' },
    note: 'spotlight videos, t.snapchat.com short links',
  },
];

export const PLATFORM_NAMES = PLATFORMS.map((platform) => platform.name);

export const FEATURE_LIST = [
  'Your phone is the engine',
  '16 platforms, one paste box',
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
      "Yes — 100%. No premium tier, no ads, no per-download caps. Downloading happens right on your phone, so there's no server bill to pass on to you.",
  },
  {
    question: 'Why an APK instead of the Play Store?',
    answer:
      "Google's Play Store doesn't allow apps that download from YouTube and other platforms, so we ship as an APK instead. Installing takes about a minute, and updates install themselves silently after that.",
  },
  {
    question: 'Is there an iPhone or iOS version?',
    answer:
      "Not yet — Phantom is Android-only. An iPhone app means a paid Apple Developer account and App Store approval, so we're focusing on Android first. No iPhone app yet, and unlike Android you can't just install an app file yourself — official <a href='https://www.ninjaone.com/it-hub/endpoint-management/what-is-sideloading/' target='_blank' rel='noopener noreferrer' class='text-cyan-400 underline underline-offset-2 hover:text-cyan-300'>sideloading</a> is limited to Apple's developer tools or, in the EU since iOS 17.4, alternative app stores.",
  },
  {
    question: 'Does it need an account?',
    answer:
      'No. Downloading is completely anonymous. The community Updates feed is optional — sign in only if you want to react and comment.',
  },
  {
    question: 'Is it safe to install?',
    answer:
      'Yes. Your downloads runs <a href="https://share.google/aimode/QJ1nCHhz6DNikCHU7" target="_blank" rel="noopener noreferrer" class="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">fully on-device</a> — media is fetched and saved by your own phone, it\'s never sent to a <a href="https://www.one.com/en-gb/academy/what-is-a-server/" target="_blank" rel="noopener noreferrer" class="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">server</a>. The social Updates tab is only optional login for comments and likes, and we send anonymous crash info to fix bugs — none of it touches your downloaded media.',
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
    id: 'updates_feed',
    label: 'Updates',
    caption: 'A community feed for what ships next — react & comment.',
  },
  {
    id: 'comments_section',
    label: 'Comments',
    caption: 'Reply with words or images — right under any update.',
  },
  {
    id: 'settings_screen',
    label: 'Settings',
    caption: 'Themes, defaults and privacy — tuned your way.',
  },
];
