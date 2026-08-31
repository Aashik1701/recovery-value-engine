/**
 * A labelled range slider used across Recovery Lab controls -- the click-to-run
 * SimulationControls panel and the live InteractivePanel. `onChange` fires on
 * every drag step (the native `input` event), not just on release, so the
 * interactive panel can recompute live.
 */
export function RangeField({
  label,
  id,
  value,
  min,
  max,
  step,
  format,
  hint,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </label>
        <span
          className="text-xs font-data"
          style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}
        >
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={format(value)}
        className="w-full"
        style={{ accentColor: "var(--color-primary)" }}
      />
      {hint && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
