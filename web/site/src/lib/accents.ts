export const ACCENTS = {
  cyan: {
    card:
      'border-cyan-400/40 shadow-[7px_7px_0_rgba(6,182,212,0.3)] hover:border-cyan-400/70 hover:shadow-[11px_11px_0_rgba(6,182,212,0.4)]',
    chip: 'border-cyan-400/30 from-cyan-400/15 to-cyan-400/5 [&_svg]:text-cyan-300',
    line: 'after:from-cyan-300 after:to-violet-400',
  },
  violet: {
    card:
      'border-violet-400/40 shadow-[7px_7px_0_rgba(124,58,237,0.3)] hover:border-violet-400/70 hover:shadow-[11px_11px_0_rgba(124,58,237,0.4)]',
    chip: 'border-violet-400/30 from-violet-400/15 to-violet-400/5 [&_svg]:text-violet-300',
    line: 'after:from-violet-300 after:to-cyan-400',
  },
} as const;

export type Accent = keyof typeof ACCENTS;
