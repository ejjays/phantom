import { useState } from 'react';

const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'x',
  'facebook',
  'threads',
  'bluesky',
  'reddit',
  'soundcloud',
  'spotify',
  'vimeo',
  'bilibili',
  'dailymotion',
] as const;

const LABELS: Record<(typeof PLATFORMS)[number], string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
  threads: 'Threads',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  vimeo: 'Vimeo',
  bilibili: 'Bilibili',
  dailymotion: 'Dailymotion',
};

function LogoRun({ hidden }: { hidden?: boolean }) {
  return (
    <div aria-hidden={hidden} className="flex shrink-0 items-center gap-10 pr-10">
      {PLATFORMS.map((platform) => (
        <img
          key={platform}
          src={`/logos/${platform}.svg`}
          alt={LABELS[platform]}
          title={LABELS[platform]}
          width={26}
          height={26}
          loading="lazy"
          className="opacity-50 transition-opacity hover:opacity-100"
        />
      ))}
    </div>
  );
}

export default function PlatformMarquee() {
  const [paused, setPaused] = useState(false);

  return (
    <section
      aria-label="Supported platforms"
      className="border-y border-white/5 bg-surface/40 py-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p className="mb-5 text-center text-[11px] tracking-[0.3em] text-slate-500 uppercase">
        works with
      </p>
      <div
        className="overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)',
        }}
      >
        <div
          className="flex w-max"
          style={{
            animation: 'marquee 36s linear infinite',
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          <LogoRun />
          <LogoRun hidden />
        </div>
      </div>
    </section>
  );
}
