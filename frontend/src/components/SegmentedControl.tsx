/**
 * The one segmented/radio-group control every "pick one of a few options"
 * UI uses. Previously reimplemented twice, near-identically, in
 * SimulationControls.tsx and RecoveryNegotiation.tsx (same role="radiogroup"
 * pattern, same --color-primary-subtle active state, differing only by a
 * few px of padding neither file had a reason to differ on).
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  fullWidth = true,
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  fullWidth?: boolean;
  /** Accessible name for the radiogroup -- without it, a screen reader has
   *  no way to announce what this set of options controls. */
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex rounded border overflow-hidden ${fullWidth ? "w-full" : ""}`}
      style={{ borderColor: "var(--color-border)", borderRadius: "var(--radius-md)" }}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`text-xs font-medium py-1.5 px-3 transition-colors ${fullWidth ? "flex-1" : ""}`}
            style={{
              background: active ? "var(--color-primary-subtle)" : "var(--color-bg-surface)",
              color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
              borderLeft: i === 0 ? "none" : "1px solid var(--color-border)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
