import bilibiliLogo from '../assets/logos/bilibili.svg';
import blueskyLogo from '../assets/logos/bluesky.svg';
import dailymotionLogo from '../assets/logos/dailymotion.svg';
import facebookLogo from '../assets/logos/facebook.svg';
import instagramLogo from '../assets/logos/instagram.svg';
import redditLogo from '../assets/logos/reddit.svg';
import soundcloudLogo from '../assets/logos/soundcloud.svg';
import spotifyLogo from '../assets/logos/spotify.svg';
import threadsLogo from '../assets/logos/threads.svg';
import tiktokLogo from '../assets/logos/tiktok.svg';
import vimeoLogo from '../assets/logos/vimeo.svg';
import xLogo from '../assets/logos/x.svg';
import youtubeLogo from '../assets/logos/youtube.svg';

export const APP_VERSION = '1.2.22';

export const REPO_URL = 'https://github.com/ejjays/phantom';
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;

export interface Platform {
  readonly name: string;
  readonly logo: string;
}

export const PLATFORMS: readonly Platform[] = [
  { name: 'YouTube', logo: youtubeLogo },
  { name: 'TikTok', logo: tiktokLogo },
  { name: 'Instagram', logo: instagramLogo },
  { name: 'X', logo: xLogo },
  { name: 'Facebook', logo: facebookLogo },
  { name: 'Threads', logo: threadsLogo },
  { name: 'Bluesky', logo: blueskyLogo },
  { name: 'Reddit', logo: redditLogo },
  { name: 'SoundCloud', logo: soundcloudLogo },
  { name: 'Spotify', logo: spotifyLogo },
  { name: 'Vimeo', logo: vimeoLogo },
  { name: 'Bilibili', logo: bilibiliLogo },
  { name: 'Dailymotion', logo: dailymotionLogo },
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
