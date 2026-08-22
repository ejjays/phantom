import Ghost from './Ghost';
import GlowBlob from './GlowBlob';
import { DOWNLOAD_URL } from './Navbar';

export default function Cta() {
  return (
    <section className="relative px-4 pt-10 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-b from-surface to-[#05041a] px-6 py-14 text-center sm:px-12">
        <GlowBlob color="#06b6d4" size={480} x="50%" y="100%" />
        <Ghost className="mx-auto mb-4 h-32 drop-shadow-[0_0_28px_rgba(34,211,238,0.35)]" />
        <h2 className="text-glow text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to make some magic?
        </h2>
        <p className="mx-auto mt-4 max-w-md font-sans text-sm text-slate-400 sm:text-base">
          Grab the APK, paste your first link, and watch it land in your gallery.
          Free forever.
        </p>
        <a
          href={DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-[#030014] shadow-[0_0_40px_-6px_rgba(6,182,212,0.8)] transition-all hover:scale-[1.03] hover:bg-cyan-400 active:scale-95"
        >
          Download Phantom
        </a>
      </div>
    </section>
  );
}
