export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Interject">
      <defs>
        <linearGradient id="interject-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--warn)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#interject-mark)" />
      {/* A speech wave cut clean through the middle: the interruption. */}
      <g fill="var(--accent-foreground)">
        <rect x="7" y="13" width="2.6" height="6" rx="1.3" opacity="0.9" />
        <rect x="11.4" y="9.5" width="2.6" height="13" rx="1.3" opacity="0.9" />
        <rect x="18" y="9.5" width="2.6" height="13" rx="1.3" opacity="0.45" />
        <rect x="22.4" y="13" width="2.6" height="6" rx="1.3" opacity="0.45" />
      </g>
      <rect x="15.2" y="5" width="1.6" height="22" rx="0.8" fill="var(--accent-foreground)" />
    </svg>
  );
}
