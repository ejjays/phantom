import { DOWNLOAD_URL } from './Navbar';

export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 sm:px-6 md:flex-row md:justify-between">
        <div className="flex items-center gap-3">
          <img src="/brand/icon.png" alt="" width={26} height={26} className="rounded-md" />
          <div>
            <p className="text-sm font-semibold">Phantom</p>
            <p className="font-mono text-[11px] text-slate-500">
              download · mux · save — fully on-device
            </p>
          </div>
        </div>

        <nav aria-label="Footer" className="flex items-center gap-6 text-xs text-slate-400">
          <a href="#features" className="transition-colors hover:text-cyan-300">
            Features
          </a>
          <a href="#screens" className="transition-colors hover:text-cyan-300">
            Screens
          </a>
          <a href="#how" className="transition-colors hover:text-cyan-300">
            How it works
          </a>
          <a href="#faq" className="transition-colors hover:text-cyan-300">
            FAQ
          </a>
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-cyan-300"
          >
            GitHub
          </a>
        </nav>
      </div>
      <p className="mt-8 text-center font-mono text-[11px] text-slate-600">
        © 2026 Phantom · not affiliated with any platform listed above
      </p>
    </footer>
  );
}
