/**
 * Phantom mascot — extracted from the app's own `phantom-hero.svg` artwork,
 * self-contained (own gradients/filters/animations). Class names are ph-
 * prefixed because inline-svg <style> applies document-wide.
 */
export default function Ghost({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="45 25 330 390"
      role="img"
      aria-label="Phantom mascot"
      className={className}
    >
      <defs>
        <style>{`
          @keyframes ph-float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-15px); } }
          @keyframes ph-shadow-pulse { 0%, 100% { transform: scale(1); opacity: 0.2; } 50% { transform: scale(0.82); opacity: 0.1; } }
          @keyframes ph-blink { 0%, 92%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
          @keyframes ph-mouth-morph {
            0%, 8.62% { d: path('M 187 218 Q 200 225 213 218 Q 200 219 187 218 Z'); }
            11.21% { d: path('M 186 213 Q 200 237 214 213 Q 200 207 186 213 Z'); }
            97.41% { d: path('M 186 213 Q 200 237 214 213 Q 200 207 186 213 Z'); }
            100% { d: path('M 187 218 Q 200 225 213 218 Q 200 219 187 218 Z'); }
          }
          .ph-ghost-body { animation: ph-float 3.2s ease-in-out infinite; }
          .ph-ghost-shadow { animation: ph-shadow-pulse 3.2s ease-in-out infinite; transform-origin: 200px 385px; }
          .ph-ghost-eyes { animation: ph-blink 4.2s infinite; transform-origin: 200px 180px; }
          .ph-ghost-mouth { animation: ph-mouth-morph 11.6s ease-in-out 2s infinite backwards; }
        `}</style>
        <linearGradient id="ph-body-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E0F7FA" />
          <stop offset="60%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
        <filter id="ph-drop" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#06B6D4" floodOpacity="0.3" />
        </filter>
      </defs>
      <ellipse
        className="ph-ghost-shadow"
        cx="200"
        cy="385"
        rx="75"
        ry="10"
        fill="#083344"
        opacity="0.2"
      />
      <g className="ph-ghost-body" filter="url(#ph-drop)">
        <path
          d="M 80 170 C 80 103.7, 133.7 50, 200 50 C 266.3 50, 320 103.7, 320 170 L 320 330 Q 290 352, 260 330 Q 230 352, 200 330 Q 170 352, 140 330 Q 110 352, 80 330 Z"
          fill="url(#ph-body-grad)"
        />
        <path
          d="M 285 105 C 305 140, 320 220, 320 330 Q 290 352, 260 330 Q 250 322, 245 310 C 270 270, 280 180, 285 105 Z"
          fill="#0891B2"
          opacity="0.4"
        />
        <g className="ph-ghost-eyes">
          <ellipse cx="165" cy="180" rx="13" ry="18" fill="#083344" />
          <ellipse cx="168" cy="175" rx="5" ry="7" fill="#FFFFFF" />
          <ellipse cx="235" cy="180" rx="13" ry="18" fill="#083344" />
          <ellipse cx="238" cy="175" rx="5" ry="7" fill="#FFFFFF" />
        </g>
        <ellipse cx="148" cy="197" rx="9" ry="5" fill="#0891B2" opacity="0.6" />
        <ellipse cx="252" cy="197" rx="9" ry="5" fill="#0891B2" opacity="0.6" />
        <path
          className="ph-ghost-mouth"
          d="M 187 218 Q 200 225 213 218 Q 200 219 187 218 Z"
          fill="#083344"
        />
      </g>
    </svg>
  );
}
