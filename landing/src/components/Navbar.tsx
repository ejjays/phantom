import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#screens', label: 'Screens' },
  { href: '#how', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
] as const;

export const DOWNLOAD_URL = 'https://github.com/ejjays/phantom/releases';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors ${
        scrolled ? 'border-b border-white/5 bg-[#030014]/85 backdrop-blur-xl' : ''
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <img src="/brand/icon.png" alt="" width={30} height={30} className="rounded-lg" />
          <span className="text-lg font-semibold tracking-tight">Phantom</span>
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-slate-400 transition-colors hover:text-cyan-300"
            >
              {link.label}
            </a>
          ))}
        </div>
        <a
          href={DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-[#030014] transition-transform hover:scale-105 active:scale-95"
        >
          <Download size={15} strokeWidth={2.5} />
          Download
        </a>
      </nav>
    </header>
  );
}
