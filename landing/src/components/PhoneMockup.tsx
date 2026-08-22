import type { CSSProperties } from 'react';

interface PhoneMockupProps {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
}

export default function PhoneMockup({ src, alt, className = '' }: PhoneMockupProps) {
  return (
    <div
      className={`relative rounded-[2.6rem] border border-white/10 bg-black p-2 shadow-[0_0_36px_-14px_rgba(6,182,212,0.5)] ${className}`}
      style={{ transform: 'translateZ(0)' } as CSSProperties}
    >
      <div className="overflow-hidden rounded-[2rem] border border-white/5">
        <img
          src={`/screenshots/${src}.webp`}
          alt={alt}
          width={408}
          height={900}
          decoding="async"
          draggable={false}
          className="block h-auto w-full"
        />
      </div>
      <div className="pointer-events-none absolute top-3 left-1/2 h-5 w-28 -translate-x-1/2 rounded-full bg-black" />
    </div>
  );
}
