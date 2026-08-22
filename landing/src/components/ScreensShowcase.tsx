import { useCallback, useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { EmblaCarouselType } from 'embla-carousel';
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import PhoneMockup from './PhoneMockup';

const SCREENS = [
  {
    id: 'home_screen',
    label: 'Home',
    caption: 'One box. Paste any link — Phantom figures out the rest.',
  },
  {
    id: 'video_download',
    label: 'Quality picker',
    caption: 'Up to 8K. Every format and size, before you commit.',
  },
  {
    id: 'audio_download',
    label: 'Audio mode',
    caption: 'Rip clean audio as MP3 or M4A, tagged automatically.',
  },
  {
    id: 'download_history',
    label: 'History',
    caption: 'Everything you grabbed, one tap to replay or share.',
  },
  {
    id: 'updates_feed',
    label: 'Updates',
    caption: 'A community feed for what ships next — react & comment.',
  },
  {
    id: 'settings_screen',
    label: 'Settings',
    caption: 'Themes, defaults and privacy — tuned your way.',
  },
] as const;

const JIGGLE_PX = 10;
const SETTLE_MS = 250;
const CARD_STEP = 296;

const listVariants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0, delayChildren: 0.1 } },
};

const fanVariants = {
  hidden: (index: number) => ({
    x: ((SCREENS.length - 1) / 2 - index) * CARD_STEP,
    opacity: 0,
  }),
  shown: (index: number) => ({
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 110,
      damping: 19,
      delay: Math.abs((SCREENS.length - 1) / 2 - index) * 0.08,
    },
  }),
};

const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
) => outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
}

function JiggleCard({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const controls = useAnimationControls();
  const settleTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  useEffect(() => {
    if (!active) return;
    void controls.start({ x: (Math.random() * 2 - 1) * JIGGLE_PX, y: 0 });
  }, [active, controls]);

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    void controls.start({
      x: mapRange(-dx, -rect.width / 2, rect.width / 2, -JIGGLE_PX, JIGGLE_PX),
      y: mapRange(-dy, -rect.height / 2, rect.height / 2, -JIGGLE_PX, JIGGLE_PX),
    });
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      void controls.start({ x: 0, y: 0 });
    }, SETTLE_MS);
  };

  return (
    <motion.div
      animate={controls}
      transition={{ type: 'spring', stiffness: 150 }}
      onMouseMove={onMouseMove}
      className="flex h-full flex-col items-center gap-4"
    >
      {children}
    </motion.div>
  );
}

export default function ScreensShowcase() {
  const isNarrow = useIsNarrow();
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: 'start',
      axis: 'x',
      containScroll: 'trimSnaps',
      dragFree: !isNarrow,
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
  const [snapCount, setSnapCount] = useState<number>(SCREENS.length);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const active = SCREENS[selected];

  useEffect(() => {
    emblaApi?.reInit();
  }, [emblaApi, isNarrow]);

  const onSelect = useCallback((api: EmblaCarouselType) => {
    setSelected(api.selectedScrollSnap());
    setSnapCount(api.scrollSnapList().length);
    setCanPrev(api.canScrollPrev());
    setCanNext(api.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on('select', onSelect).on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect).off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <section id="screens" className="relative py-14 sm:py-20">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <p className="mb-3 text-xs tracking-[0.25em] text-cyan-400 uppercase">
          {'// screenshots'}
        </p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Straight out of the app
        </h2>
        <p className="mt-4 font-sans text-base text-slate-400">
          No mockups — this is Phantom running on a real phone. Drag or swipe.
        </p>
      </div>

      <div
        ref={emblaRef}
        className="cursor-ew-resize touch-pan-y overflow-hidden select-none"
        style={{
          maskImage:
            'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
        }}
      >
        <motion.div
          variants={listVariants}
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, margin: '-80px' }}
          className="flex items-stretch gap-9 py-6 pl-4 pr-4 sm:pl-6 sm:pr-10"
        >
          {SCREENS.map((screen, index) => (
            <motion.div
              key={screen.id}
              custom={index}
              variants={fanVariants}
              className="w-[260px] shrink-0"
            >
              <JiggleCard active={index === selected}>
                <PhoneMockup src={screen.id} alt={`Phantom ${screen.label} screen`} />
                <p className="font-mono text-xs tracking-[0.22em] text-slate-400 uppercase">
                  {String(index + 1).padStart(2, '0')} · {screen.label}
                </p>
              </JiggleCard>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <div className="mt-2 flex flex-col items-center gap-5 px-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={active.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="min-h-5 text-center font-mono text-sm text-slate-400"
          >
            {active.caption}
          </motion.p>
        </AnimatePresence>

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
