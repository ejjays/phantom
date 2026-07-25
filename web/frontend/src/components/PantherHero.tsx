import { useEffect, useState } from 'react';
import pantherSitting from '../assets/images/panther-sitting.png';
import pantherAttack from '../assets/images/panther-attack.png';

type Props = {
  trigger: number;
  status: string;
  isVisible?: boolean;
};

const GLITCH_DURATION = 350;
const ATTACK_DELAY = 180;
const RETURN_DURATION = 250;

export default function PantherHero({
  trigger,
  status,
  isVisible = false,
}: Props) {
  const [isGlitching, setIsGlitching] = useState(false);
  const [showAttack, setShowAttack] = useState(false);
  const [glitchRun, setGlitchRun] = useState(0);

  useEffect(() => {
    if (!trigger) return;

    setGlitchRun((count) => count + 1);
    setIsGlitching(true);

    const attackTimer = setTimeout(() => {
      setShowAttack(true);
    }, ATTACK_DELAY);

    const glitchEndTimer = setTimeout(() => {
      setIsGlitching(false);
    }, GLITCH_DURATION);

    return () => {
      clearTimeout(attackTimer);
      clearTimeout(glitchEndTimer);
    };
  }, [trigger]);

  useEffect(() => {
    if (showAttack && (status === 'completed' || status === 'idle')) {
      const timer = setTimeout(() => {
        setShowAttack(false);
      }, RETURN_DURATION);
      return () => clearTimeout(timer);
    }
  }, [showAttack, status]);

  const baseWidth = isVisible ? 'w-24 sm:w-36 md:w-44' : 'w-32 sm:w-36 md:w-44';

  return (
    <div className="relative flex flex-col items-center justify-center gap-4">
      <style>{`
        @keyframes panther-glitch {
          0% { transform: translate(0, 0) scale(1) rotate(0deg); }
          11.4% { transform: translate(-6px, 0) scale(1.12) rotate(-5deg); }
          22.9% { transform: translate(8px, 0) scale(0.92) rotate(4deg); }
          30% { transform: translate(-4px, 0) scale(1.08) rotate(-3deg); }
          40% { transform: translate(5px, 0) scale(0.95) rotate(2deg); }
          48.6% { transform: translate(-3px, 0) scale(1.05) rotate(-2deg); }
          57.1% { transform: translate(4px, 0) scale(0.98) rotate(1deg); }
          100% { transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes panther-debris-magenta {
          0%, 100% { opacity: 0; transform: translate(0); }
          14.3% { opacity: 0.5; transform: translate(-8px); }
          28.6% { opacity: 0.25; transform: translate(6px); }
          42.9% { opacity: 0.4; transform: translate(-5px); }
          57.1% { opacity: 0.15; transform: translate(3px); }
          71.4% { opacity: 0.3; transform: translate(0); }
          85.7% { opacity: 0; transform: translate(0); }
        }
        @keyframes panther-debris-cyan {
          0%, 100% { opacity: 0; transform: translate(0); }
          14.3% { opacity: 0.4; transform: translate(8px); }
          28.6% { opacity: 0.2; transform: translate(-6px); }
          42.9% { opacity: 0.35; transform: translate(5px); }
          57.1% { opacity: 0.1; transform: translate(-3px); }
          71.4% { opacity: 0.25; transform: translate(0); }
          85.7% { opacity: 0; transform: translate(0); }
        }
        @keyframes panther-slice {
          0%, 100% { opacity: 0; transform: translate(0, 0); }
          16.7% { opacity: 0.5; transform: translate(0, -20px); }
          33.3% { opacity: 0.3; transform: translate(0, 20px); }
          50% { opacity: 0.45; transform: translate(0, -12px); }
          66.7% { opacity: 0.2; transform: translate(0, 10px); }
          83.3% { opacity: 0; transform: translate(0, 0); }
        }
        .animate-panther-glitch {
          animation: panther-glitch 0.35s linear;
        }
        .animate-debris-magenta {
          animation: panther-debris-magenta 0.35s linear;
        }
        .animate-debris-cyan {
          animation: panther-debris-cyan 0.35s linear;
        }
        .animate-panther-slice {
          animation: panther-slice 0.35s linear;
        }
      `}</style>

      <div className="relative flex items-center justify-center">
        <div className={`relative ${baseWidth} aspect-[781/919]`}>
          {/* magenta offset debris */}
          <img
            key={`debris-magenta-${glitchRun}`}
            src={pantherSitting}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-contain ${
              isGlitching ? 'animate-debris-magenta' : 'opacity-0'
            }`}
            style={{
              filter: 'invert(1) sepia(1) saturate(5) hue-rotate(280deg)',
              mixBlendMode: 'screen',
            }}
          />

          {/* cyan offset debris */}
          <img
            key={`debris-cyan-${glitchRun}`}
            src={pantherSitting}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-contain ${
              isGlitching ? 'animate-debris-cyan' : 'opacity-0'
            }`}
            style={{
              filter: 'invert(1) sepia(1) saturate(5) hue-rotate(145deg)',
              mixBlendMode: 'screen',
            }}
          />

          {/* sliced horizontal strip */}
          <img
            key={`debris-slice-${glitchRun}`}
            src={pantherSitting}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-contain ${
              isGlitching ? 'animate-panther-slice' : 'opacity-0'
            }`}
            style={{
              clipPath: 'inset(35% 0 35% 0)',
              filter: 'contrast(1.3)',
            }}
          />

          {/* sitting panther - hidden during attack */}
          <img
            src={pantherSitting}
            alt="Panther Mascot"
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-75 ${
              showAttack
                ? 'opacity-0'
                : isGlitching
                  ? 'animate-panther-glitch'
                  : ''
            }`}
          />

          {/* attack panther */}
          <img
            src={pantherAttack}
            alt="Panther Mascot"
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-75 ${
              showAttack ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
