import { motion } from 'framer-motion';
import { ArrowDown, Download } from 'lucide-react';
import GlowBlob from './GlowBlob';
import PhoneMockup from './PhoneMockup';
import Starfield, { ShootingStars } from './Starfield';
import { DOWNLOAD_URL } from './Navbar';

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 sm:pt-36">
      <Starfield />
      <ShootingStars />
      <GlowBlob color="#7c3aed" size={620} x="-10%" y="-14%" />
      <GlowBlob color="#06b6d4" size={700} x="70%" y="55%" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col items-start gap-6">
          <div className="relative rounded-2xl rounded-bl-sm border border-cyan-400/20 bg-surface px-4 py-3 text-sm text-cyan-100/90">
            Hi, welcome — I&apos;m Phantom, let&apos;s make some magic..
            <span className="absolute -bottom-2 left-5 h-3 w-3 rotate-45 border-b border-l border-cyan-400/20 bg-surface" />
          </div>

          <h1 className="text-glow text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Any video.
            <br />
            Any music.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-transparent">
              One paste.
            </span>
          </h1>

          <p className="max-w-lg font-sans text-base leading-relaxed text-slate-400 sm:text-lg">
            Phantom pulls videos &amp; music from{' '}
            <span className="text-slate-200">13 platforms</span> straight into your
            gallery — muxed, tagged and saved right on your phone. No servers in the
            way. No accounts. No limits.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <a
              href={DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-[#030014] shadow-[0_0_40px_-6px_rgba(6,182,212,0.8)] transition-all hover:scale-[1.03] hover:bg-cyan-400 active:scale-95"
            >
              <Download size={19} strokeWidth={2.5} />
              Download now — free
            </a>
            <a
              href="#screens"
              className="flex items-center gap-2 rounded-full border border-white/10 px-6 py-3.5 text-sm text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
            >
              See it in action
              <ArrowDown size={15} />
            </a>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
          className="relative mx-auto w-full max-w-[300px]"
        >
          <PhoneMockup
            src="home_screen"
            alt="Phantom home screen with paste link input and download button"
          />
        </motion.div>
      </div>
    </section>
  );
}
