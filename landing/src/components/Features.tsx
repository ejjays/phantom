import {
  BellRing,
  Gauge,
  ImageDown,
  Music4,
  Radar,
  Smartphone,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Smartphone,
    title: 'Your phone is the engine',
    body: 'Resolve, download and mux run entirely on-device. A residential IP sails past the bot-walls that kill datacenter downloaders.',
  },
  {
    icon: Radar,
    title: '13 platforms, one paste box',
    body: 'Auto mode detects the site for you. YouTube runs through a stealth in-app session that solves BotGuard & PO tokens on your behalf.',
  },
  {
    icon: Gauge,
    title: 'Full-bandwidth chunking',
    body: 'Parallel 4 MB ranged requests restore the speed YouTube throttles down to playback pace.',
  },
  {
    icon: Music4,
    title: 'Up to 8K — or just the audio',
    body: 'Stream-copy muxing skips re-encoding entirely. Audio lands as properly tagged MP3 or M4A.',
  },
  {
    icon: ImageDown,
    title: 'Straight to your gallery',
    body: 'Finished files appear in Photos instantly via the media library — replay or share them like any other video.',
  },
  {
    icon: BellRing,
    title: 'Live progress, cancel anytime',
    body: 'A persistent notification tracks percent & speed. Abort mid-flight and temp files never linger behind.',
  },
] as const;

export default function Features() {
  return (
    <section id="features" className="relative py-14 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 text-xs tracking-[0.25em] text-cyan-400 uppercase">
          {'// features'}
        </p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everything a downloader should be
        </h2>
        <p className="mt-4 font-sans text-base text-slate-400">
          No ads, no queues, no &ldquo;free tier&rdquo;. Just the fastest path from a
          link to your gallery.
        </p>
      </div>
      <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="group rounded-2xl border border-white/8 bg-surface/60 p-6 transition-colors duration-300 hover:border-cyan-400/30 hover:bg-surface"
          >
            <div className="mb-5 inline-flex rounded-xl border border-cyan-400/15 bg-cyan-400/10 p-3 text-cyan-300 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105">
              <feature.icon size={22} strokeWidth={1.8} />
            </div>
            <h3 className="mb-2.5 text-lg font-semibold">{feature.title}</h3>
            <p className="font-sans text-sm leading-relaxed text-slate-400">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
