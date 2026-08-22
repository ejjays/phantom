interface GlowBlobProps {
  readonly color: string;
  readonly size: number;
  readonly x: string;
  readonly y: string;
}

/** Soft gaussian glow — blurred disc so edges never band into a visible rim. */
export default function GlowBlob({ color, size, x, y }: GlowBlobProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-full opacity-20"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        backgroundColor: color,
        filter: `blur(${Math.round(size / 4)}px)`,
      }}
    />
  );
}
