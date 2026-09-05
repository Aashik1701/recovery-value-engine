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

export function InfoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <circle cx="8" cy="8" r="6.2" strokeWidth="1.3" />
      <path d="M8 7.2v4.3" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="4.8" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BookOpenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path
        d="M2.5 3.5C2.5 2.67 3.17 2 4 2h3.5v11.5H4c-.83 0-1.5-.67-1.5-1.5v-8.5ZM13.5 3.5c0-.83-.67-1.5-1.5-1.5H8.5v11.5H12c.83 0 1.5-.67 1.5-1.5v-8.5Z"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M10 2.5h3.5v3.5M6.5 9.5l7-7" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 8v4.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M8 2.2s4.8 1.4 5.5 1.7v4.6c0 3.7-2.8 6-5.5 6.5C5.3 14.5 2.5 12.2 2.5 8.5V3.9C3.2 3.6 8 2.2 8 2.2Z" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m5.8 8.2 1.6 1.6 3.1-3.3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CodeFileIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M3 2.5h6.5l3.5 3.5v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" strokeWidth="1.3" />
      <path d="m5.5 8-1.5 1.5 1.5 1.5M8 8l1.5 1.5L8 11" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TableIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" strokeWidth="1.3" />
      <path d="M2 6.5h12M6.5 6.5v7" strokeWidth="1.3" />
    </svg>
  );
}

export function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="m8 2.5 5.5 3-5.5 3-5.5-3 5.5-3ZM2.5 8.5 8 11.5l5.5-3M2.5 11.5 8 14.5l5.5-3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


