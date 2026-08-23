export const ACCENTS = {
  cyan: {
    // side = extruded slab under the face (like Button3D bg-cyan-800)
    side: 'bg-cyan-950',
    face: 'border-cyan-400/40 [&_svg]:text-cyan-300',
    chip: 'border-cyan-400/30 from-cyan-400/15 to-cyan-400/5 [&_svg]:text-cyan-300',
    line: 'after:from-cyan-300 after:to-violet-400',
    num: 'text-cyan-400/40 group-hover:text-cyan-300/70',
  },
  violet: {
    side: 'bg-violet-950',
    face: 'border-violet-400/40 [&_svg]:text-violet-300',
    chip: 'border-violet-400/30 from-violet-400/15 to-violet-400/5 [&_svg]:text-violet-300',
    line: 'after:from-violet-300 after:to-cyan-400',
    num: 'text-violet-400/40 group-hover:text-violet-300/70',
  },
} as const;

export type Accent = keyof typeof ACCENTS;
