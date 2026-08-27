/**
 * Shared icon set. Every icon in this app draws from this file -- inline
 * SVG, one consistent 16x16 viewBox, stroke=currentColor, strokeWidth 1.3,
 * matching Layout.tsx's original nav-icon convention. Replaces the unicode
 * glyphs (✓ ⚠ ✗ ▾ ▸ ↓ ← →) that had drifted in across PaymentDetail,
 * RootCauseBreakdown, LossChain, and pagination controls -- an icon system
 * should be drawn, not typed.
 */

function iconProps() {
  return { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor" } as const;
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M3 8.5 6.2 11.5 13 4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WarningIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M8 2.2 14.3 13.2H1.7Z" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.4v3.2" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CrossIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M4 4 12 12M12 4 4 12" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, open = true }: { size?: number; open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 150ms ease-out" }}
    >
      <path d="M4 6.5 8 10.5 12 6.5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M8 2.5v9M4.5 8 8 11.5 11.5 8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M11.5 8h-8M6.5 4 2.5 8l4 4" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M4.5 8h8M9.5 4l4 4-4 4" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <circle cx="7" cy="7" r="4.5" strokeWidth="1.3" />
      <path d="M10.5 10.5 14 14" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
