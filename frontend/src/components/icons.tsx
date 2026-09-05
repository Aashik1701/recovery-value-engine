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

export function FlagIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="M3 2v12M3 2.5h8.5l-1.5 3.5 1.5 3.5H3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SlashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <circle cx="8" cy="8" r="6.2" strokeWidth="1.3" />
      <path d="m3.8 3.8 8.4 8.4" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function StarIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps()} width={size} height={size}>
      <path d="m8 1.8 1.9 4 4.4.6-3.2 3.1.8 4.3L8 11.7l-3.9 2.1.8-4.3-3.2-3.1 4.4-.6L8 1.8Z" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}




