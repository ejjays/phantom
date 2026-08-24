import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { EmblaCarouselType } from 'embla-carousel';
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';
import { motion, useAnimationControls, useInView } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { SCREENSHOTS } from '../content/site';

const JIGGLE_PX = 10;
const SETTLE_MS = 250;
const DECK_GAP_PX = 24;
const DECK_GAP_MOBILE_PX = 6;
// phantom.com deck->row spring: stiffness 100 / damping 15 gives slight overshoot
const DECK_SPRING = { type: 'spring', stiffness: 100, damping: 15 } as const;

const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
) => outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);

function JiggleCard({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const settleTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  useEffect(() => {
    if (!active) return;
    setOffset({ x: (Math.random() * 2 - 1) * JIGGLE_PX, y: 0 });
  }, [active]);

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!active) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    setOffset({
      x: mapRange(-dx, -rect.width / 2, rect.width / 2, -JIGGLE_PX, JIGGLE_PX),
      y: mapRange(-dy, -rect.height / 2, rect.height / 2, -JIGGLE_PX, JIGGLE_PX),
    });
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setOffset({ x: 0, y: 0 }), SETTLE_MS);
  };

  return (
    <div
      onMouseMove={onMouseMove}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: 'transform 150ms cubic-bezier(0.22, 1.4, 0.36, 1)',
      }}
      className="flex h-full flex-col items-center gap-4"
    >
      {children}
    </div>
  );
}

function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative rounded-[2.6rem] border border-white/10 bg-black p-2 shadow-[0_0_36px_-14px_rgba(6,182,212,0.5)]">
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

/**
 * phantom.com moduleCardsSliderWithIntro intro: before reveal, cards are
 * teleported (pre-paint, no tween) into a centered overlapping deck fanned
 * ~24px per card (6px mobile, offsets clamped ±1 step), first card on top.
 * At ~75% visibility they all spring sideways into the row, each landing
 * with a random ±10px vertical wobble so nothing lands robotically.
 */
function DeckCard({
  index,
  count,
  revealed,
  active,
  children,
}: {
  index: number;
  count: number;
  revealed: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const stagedRef = useRef(false);
  const [staged, setStaged] = useState(false);
  const [landingY] = useState(() => (Math.random() * 2 - 1) * JIGGLE_PX);

  // instant teleport to deck position, before browser paint
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !revealed && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const mobile = matchMedia('(max-width: 640px)').matches;
      const gap = mobile ? DECK_GAP_MOBILE_PX : DECK_GAP_PX;
      const middle = (count - 1) / 2;
      let step = index - middle;
      if (mobile) step = Math.max(-1, Math.min(1, step));
      const rect = el.getBoundingClientRect();
      const docLeft = rect.left + window.scrollX;
      const target = window.innerWidth / 2 - rect.width / 2 + step * gap;
      controls.set({ x: Math.trunc(target - docLeft) });
      stagedRef.current = true;
    }
    setStaged(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (revealed && stagedRef.current) {
      stagedRef.current = false;
      controls.start({ x: 0, y: landingY }, DECK_SPRING);
    }
  }, [revealed, controls, landingY]);

  return (
    <motion.div
      ref={ref}
      animate={controls}
      data-deck-pending={staged ? undefined : ''}
      style={{ zIndex: count - 1 - index }}
      className="relative w-[260px] shrink-0"
    >
      <JiggleCard active={revealed && active}>
        {children}
      </JiggleCard>
    </motion.div>
  );
}

export default function ScreensShowcase() {
  // SSR renders without window; hydrate picks the phone-friendly align
  const [align] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
      ? ('center' as const)
      : ('start' as const),
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  // trigger the deck release at 75% visibility, once
  const threeQuarterVisible = useInView(wrapRef, { once: true, amount: 0.75 });
  const revealed =
    threeQuarterVisible ||
    (typeof window !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align,
      axis: 'x',
      containScroll: 'trimSnaps',
      dragFree: false,
    },
    [
      WheelGesturesPlugin({
        active: true,
        forceWheelAxis: 'x',
        wheelDraggingClass: 'wheel-dragging',
      }),
    ],
  );
  const [selected, setSelected] = useState(0);
  const [snapCount, setSnapCount] = useState<number>(SCREENSHOTS.length);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const active = SCREENSHOTS[selected];

  const onSelect = useCallback((api: EmblaCarouselType) => {
    setSelected(api.selectedScrollSnap());
    setSnapCount(api.scrollSnapList().length);
    setCanPrev(api.canScrollPrev());
    setCanNext(api.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return undefined;
    onSelect(emblaApi);
    emblaApi.on('select', onSelect).on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect).off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <section id="screens" className="relative py-14 sm:py-20">
      <div data-reveal className="mx-auto mb-8 max-w-2xl text-center">
        <p className="mb-3 text-xs tracking-[0.25em] text-cyan-400 uppercase">{'// screenshots'}</p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Straight out of the app</h2>
        <p className="mt-4 font-sans text-base text-slate-400">
          No mockups — this is Phantom running on a real phone. Drag or swipe.
        </p>
      </div>

      <div
        ref={(node) => {
          wrapRef.current = node;
          emblaRef(node);
        }}
        className="cursor-ew-resize touch-pan-y overflow-hidden select-none"
        style={{
          maskImage:
            'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
        }}
      >
        <div className="flex items-stretch gap-9 py-6 pr-4 pl-4 sm:pr-10 sm:pl-6">
          {SCREENSHOTS.map((screen, index) => (
            <DeckCard
              key={screen.id}
              index={index}
              count={SCREENSHOTS.length}
              revealed={revealed}
              active={index === selected}
            >
              <PhoneFrame src={screen.id} alt={`Phantom ${screen.label} screen`} />
              <p className="font-mono text-xs tracking-[0.22em] text-slate-400 uppercase">
                {String(index + 1).padStart(2, '0')} · {screen.label}
              </p>
            </DeckCard>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-col items-center gap-5 px-4">
        <p
          key={active.id}
          className="min-h-5 text-center font-mono text-sm text-slate-400"
          style={{ animation: 'rise-in 0.25s ease-out' }}
        >
          {active.caption}
        </p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Previous screen"
            onClick={() => emblaApi?.scrollPrev()}
            disabled={!canPrev}
            className="rounded-full border border-white/10 p-2.5 text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-35"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            {Array.from({ length: snapCount }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Show screen ${index + 1}`}
                onClick={() => emblaApi?.scrollTo(index)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === selected ? 'w-5 bg-cyan-400' : 'w-1.5 bg-white/15'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next screen"
            onClick={() => emblaApi?.scrollNext()}
            disabled={!canNext}
            className="rounded-full border border-white/10 p-2.5 text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-35"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
