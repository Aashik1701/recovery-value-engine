import type { RecoveryLabSimulateRequest } from "../api/types";
import { Card } from "../components/Card";
import {
  CONTACT_INTENSITY_LABELS,
  MAX_CONTACTS_OPTIONS,
  POLICY_DESCRIPTIONS,
  POLICY_LABELS,
  POLICY_ORDER,
  RECOVERY_WINDOW_OPTIONS,
  SIMULATION_RUNS_OPTIONS,
} from "./labFormat";

export type LabConfig = Omit<RecoveryLabSimulateRequest, "seed"> & { seed: number };

const CONTACT_INTENSITIES: RecoveryLabSimulateRequest["contact_intensity"][] = ["low", "moderate", "high"];

export function SimulationControls({
  config,
  onChange,
  onSimulate,
  isSimulating,
}: {
  config: LabConfig;
  onChange: (patch: Partial<LabConfig>) => void;
  onSimulate: () => void;
  isSimulating: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Simulation policy
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Configure the recovery strategy, then simulate it against the synthetic batch.
          </p>
        </div>

        <Field label="Recovery policy">
          <select
            value={config.policy}
            onChange={(e) => onChange({ policy: e.target.value as LabConfig["policy"] })}
            className="w-full rounded border px-2.5 py-1.5 text-sm"
            style={selectStyle}
          >
            {POLICY_ORDER.map((id) => (
              <option key={id} value={id}>
                {POLICY_LABELS[id]}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            {POLICY_DESCRIPTIONS[config.policy]}
          </p>
        </Field>

        <Field label="Contact intensity" hint="Which channels Aggressive Recovery is allowed to use.">
          <SegmentedControl
            options={CONTACT_INTENSITIES.map((v) => ({ value: v, label: CONTACT_INTENSITY_LABELS[v] }))}
            value={config.contact_intensity}
            onChange={(v) => onChange({ contact_intensity: v as LabConfig["contact_intensity"] })}
          />
        </Field>

        <RangeField
          label="Discount budget"
          id="discount-budget"
          value={config.discount_budget}
          min={0}
          max={100_000}
          step={1_000}
          format={(v) => `₹${v.toLocaleString("en-IN")}`}
          onChange={(v) => onChange({ discount_budget: v })}
        />

        <RangeField
          label="Voice capacity"
          id="voice-capacity"
          value={config.voice_capacity}
          min={0}
          max={5_000}
          step={50}
          format={(v) => v.toLocaleString("en-IN")}
          onChange={(v) => onChange({ voice_capacity: v })}
        />

        <Field label="Maximum contacts per customer">
          <SegmentedControl
            options={MAX_CONTACTS_OPTIONS.map((v) => ({ value: String(v), label: String(v) }))}
            value={String(config.max_contacts_per_customer)}
            onChange={(v) => onChange({ max_contacts_per_customer: Number(v) })}
          />
        </Field>

        <Field label="Recovery window">
          <SegmentedControl
            options={RECOVERY_WINDOW_OPTIONS.map((o) => ({ value: String(o.hours), label: o.label }))}
            value={String(config.recovery_window_hours)}
            onChange={(v) => onChange({ recovery_window_hours: Number(v) })}
          />
        </Field>

        <Field label="Simulation runs" hint="Monte Carlo runs used only for the uncertainty range, not the headline numbers.">
          <SegmentedControl
            options={SIMULATION_RUNS_OPTIONS.map((v) => ({ value: String(v), label: v.toLocaleString("en-IN") }))}
            value={String(config.n_simulation_runs)}
            onChange={(v) => onChange({ n_simulation_runs: Number(v) })}
          />
        </Field>

        <details>
          <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--color-text-muted)" }}>
            Advanced
          </summary>
          <div className="mt-2">
            <Field label="Simulation seed" hint="Same seed + configuration always reproduces the same result.">
              <input
                type="number"
                value={config.seed}
                onChange={(e) => onChange({ seed: Number(e.target.value) || 0 })}
                className="w-32 rounded border px-2.5 py-1.5 text-sm"
                style={{ ...selectStyle, fontFamily: "var(--font-family-data)" }}
              />
            </Field>
          </div>
        </details>

        <button
          type="button"
          onClick={onSimulate}
          disabled={isSimulating}
          className="w-full rounded py-2.5 text-sm font-semibold transition-opacity"
          style={{
            background: "var(--color-primary)",
            color: "var(--color-text-on-primary)",
            opacity: isSimulating ? 0.7 : 1,
            cursor: isSimulating ? "default" : "pointer",
          }}
        >
          {isSimulating ? "Simulating…" : "Simulate strategy"}
        </button>
      </div>
    </Card>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--color-bg-surface)",
  borderColor: "var(--color-border)",
  color: "var(--color-text-primary)",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded border overflow-hidden w-full"
      style={{ borderColor: "var(--color-border)" }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className="flex-1 text-xs font-medium py-1.5 px-2 transition-colors"
            style={{
              background: active ? "var(--color-primary-subtle)" : "var(--color-bg-surface)",
              color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
              borderLeft: opt === options[0] ? "none" : "1px solid var(--color-border)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RangeField({
  label,
  id,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </label>
        <span className="text-xs font-data" style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}>
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
    </div>
  );
}
