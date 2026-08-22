import { useState } from 'react';

const FAQS = [
  {
    question: 'Is Phantom really free?',
    answer:
      "Yes — fully. No premium tier, no ads, no per-download caps. The whole pipeline runs on your own hardware, so there's no server bill to pass on to you.",
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
      'Videos up to 8K, audio as MP3/M4A, even HLS streams assembled locally. Thirteen platforms today, with more landing in every update.',
  },
] as const;

export default function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="relative py-14 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 text-xs tracking-[0.25em] text-cyan-400 uppercase">
          {'// faq'}
        </p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Fair questions
        </h2>
      </div>
      <div className="mx-auto max-w-3xl space-y-3 px-4 sm:px-6">
        {FAQS.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={faq.question}
              className={`overflow-hidden rounded-2xl border transition-colors ${
                isOpen
                  ? 'border-cyan-400/25 bg-surface'
                  : 'border-white/8 bg-surface/50 hover:border-white/15'
              }`}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-sm font-semibold sm:text-base">{faq.question}</span>
                <span
                  className={`shrink-0 text-cyan-400 transition-transform duration-300 ${
                    isOpen ? 'rotate-45' : ''
                  }`}
                  aria-hidden
                >
                  +
                </span>
              </button>
              {isOpen && (
                <p className="px-6 pb-5 font-sans text-sm leading-relaxed text-slate-400">
                  {faq.answer}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
