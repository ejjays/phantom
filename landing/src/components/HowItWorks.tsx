import { CheckCircle2, Link2, Music4 } from 'lucide-react';

const STEPS = [
  {
    icon: Link2,
    title: 'Paste any link',
    body: 'YouTube, TikTok, Spotify, Reddit — Auto mode knows the site before you do.',
  },
  {
    icon: Music4,
    title: 'Pick quality & format',
    body: '8K to 360p, full video or audio-only MP3 — sizes shown up front.',
  },
  {
    icon: CheckCircle2,
    title: 'Saved to your gallery',
    body: 'Phantom muxes everything on-device and drops the file straight into Photos.',
  },
] as const;

export default function HowItWorks() {
  return (
    <section id="how" className="relative py-14 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 text-xs tracking-[0.25em] text-cyan-400 uppercase">
          {'// how it works'}
        </p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Three steps. Zero friction.
        </h2>
        <p className="mt-4 font-sans text-base text-slate-400">
          The whole pipeline — resolve, download, mux, save — happens between your
          fingers and your gallery.
        </p>
      </div>
      <ol className="mx-auto grid max-w-5xl gap-5 px-4 sm:grid-cols-3 sm:px-6">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative rounded-2xl border border-white/8 bg-surface/60 p-6"
          >
            <span className="absolute top-5 right-6 font-mono text-4xl font-bold text-white/5">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="mb-5 inline-flex rounded-xl border border-violet-400/15 bg-violet-400/10 p-3 text-violet-300">
              <step.icon size={22} strokeWidth={1.8} />
            </div>
            <h3 className="mb-2.5 text-base font-semibold">{step.title}</h3>
            <p className="font-sans text-sm leading-relaxed text-slate-400">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
