import { useState } from 'react';

interface StarSpec {
  readonly left: string;
  readonly top: string;
  readonly size: number;
  readonly duration: string;
  readonly delay: string;
}

function makeStars(count: number): StarSpec[] {
  const stars: StarSpec[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: 1 + Math.random() * 1.8,
      duration: `${(2.4 + Math.random() * 2).toFixed(2)}s`,
      delay: `${(Math.random() * 3).toFixed(2)}s`,
    });
  }
  return stars;
}

export default function Starfield() {
  const [stars] = useState(() => makeStars(54));

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((star, index) => (
        <span
          key={`tw-${index}`}
          className="absolute rounded-full bg-white"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            animation: `twinkle-star ${star.duration} ease-in-out ${star.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function ShootingStars() {
  const [shooters] = useState(() =>
    [0, 1, 2].map((index) => ({
      top: `${8 + index * 26}%`,
      right: `${4 + index * 22}%`,
      width: 46 + Math.random() * 30,
      duration: `${(9 + Math.random() * 5).toFixed(1)}s`,
      delay: `${(2.5 + index * 4).toFixed(1)}s`,
    }))
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {shooters.map((star, index) => (
        <span
          key={`sh-${index}`}
          className="absolute h-px rounded-full"
          style={{
            top: star.top,
            right: star.right,
            width: star.width,
            background: 'linear-gradient(90deg, transparent, #22d3ee)',
            animation: `shooting-star ${star.duration} linear ${star.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}

