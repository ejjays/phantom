import React from 'react';
import Header from './Header';
import SocialMedia from './SocialMedia';
import SupportButton from './ui/SupportButton';
import DotPattern from './ui/DotPattern';
import ShootingStars from './ui/ShootingStars';
import ErudaLoader from './utils/ErudaLoader';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="flex flex-col min-h-dvh w-full relative overflow-hidden">
      <ErudaLoader />
      <DotPattern />
      <ShootingStars />

      <Header />

      <main
        id="main-content"
        className="grow flex items-center justify-center pt-4 md:pt-0"
      >
        {children}
      </main>

      <footer className="px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] shrink-0 relative flex flex-col items-center justify-center gap-4">
        <div className="sr-only">
          <h2>
            Free Video and Audio Downloader for YouTube, Spotify, TikTok,
            Instagram and More
          </h2>
          <p>
            Panther is a free, ad-free online tool to download high-quality
            video and audio from YouTube, Spotify, TikTok, Instagram, Facebook,
            and SoundCloud. Convert YouTube videos to 4K MP4 or 320kbps MP3,
            download Spotify playlists, and save TikTok videos without
            watermark. The built-in Remix Lab uses AI to separate tracks into
            stems (vocals, bass, drums, other), detect chords and musical key,
            and shift pitch — all in your browser, with no registration
            required.
          </p>
        </div>
        <SocialMedia />
        <div className="absolute right-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:right-4 sm:bottom-4 md:left-1/2 md:translate-x-[50px] md:bottom-auto md:top-1/2 md:-translate-y-1/2">
          <SupportButton />
        </div>
      </footer>
    </div>
  );
};

export default Layout;
