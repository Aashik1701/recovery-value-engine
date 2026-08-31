/**
 * Recovery Lab -- interactive panel.
 *
 * A live, drag-to-explore layer over the SAME simulation the rest of this page
 * runs on click: `POST /recovery-lab/simulate` (backend `recovery_lab.py`).
 * Four sliders (recovery budget, contact cap, voice capacity, recovery window)
 * re-run the RVE-adaptive strategy plus its baselines on every drag step and
 * redraw the intervention allocation, headline stats, and the baseline
 * comparison. Nothing here re-implements the policy, the constraint modelling,
 * or the economics -- it only wires the existing engine to sliders.
 *
 * Offline boundary: this calls exactly one endpoint, `/recovery-lab/simulate`,
 * which is architecturally read-only (see `recovery_lab.py` docstring and
 * `test_recovery_lab_never_appends_to_audit_log`). No slider configuration can
 * cause a real message or a Razorpay call.
 *
 * Performance: `/recovery-lab/simulate` with `n_simulation_runs=0` returns in
 * ~150 ms on the default batch, so the recompute is direct -- no precomputed
 * grid. A 70 ms debounce coalesces drag steps; an AbortController + sequence
 * guard drop stale/out-of-order responses; the Monte Carlo uncertainty band is
 * fetched once, ~350 ms after the drag settles, so it never blocks the
 * headline update.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { RecoveryLabPolicyMetrics, RecoveryLabSimulateResponse } from "../api/types";
import { Card } from "../components/Card";
import { LoadingState } from "../components/PageState";
import { formatCurrency, INTERVENTION_LABELS } from "../lib/format";
import { INTERVENTION_COLORS, INTERVENTION_ORDER } from "./labFormat";
import { RangeField } from "./RangeField";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface LiveConfig {
  discount_budget: number;
  voice_capacity: number;
  max_contacts_per_customer: number;
  recovery_window_hours: number;
}

// Matches DEFAULT_CONFIG in RecoveryLab.tsx and the documented default in
// docs/RECOVERY_DIGITAL_TWIN.md Section 10, so the panel opens on the pinned
// numbers (RVE Adaptive net value = Rs.1,04,293).
const DEFAULTS: LiveConfig = {
  discount_budget: 50_000,
  voice_capacity: 1000,
  max_contacts_per_customer: 2,
  recovery_window_hours: 24 * 7,
};

const DEBOUNCE_MS = 70;
const SETTLE_MS = 350;

export function InteractivePanel() {
  const [config, setConfig] = useState<LiveConfig>(DEFAULTS);
  const configRef = useRef<LiveConfig>(DEFAULTS);
  const [result, setResult] = useState<RecoveryLabSimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const seqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  // Two independent in-flight requests: the fast headline pass and the
  // slower Monte-Carlo settle pass. A new slider move cancels BOTH (its
  // config supersedes them). The settle pass must NOT cancel the fast pass
  // -- they describe the same config, the settle just adds the band -- so
  // they get separate controllers.
  const liveAbortRef = useRef<AbortController | null>(null);
  const settleAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const settleRef = useRef<number | undefined>(undefined);

  const runSimulation = useCallback((cfg: LiveConfig, withMonteCarlo: boolean) => {
    const seq = ++seqRef.current;
    const controller = new AbortController();
    (withMonteCarlo ? settleAbortRef : liveAbortRef).current = controller;
    setUpdating(true);
    api
      .recoveryLabSimulate(
        {
          policy: "rve_adaptive",
          contact_intensity: "moderate",
          discount_budget: cfg.discount_budget,
          voice_capacity: cfg.voice_capacity,
          max_contacts_per_customer: cfg.max_contacts_per_customer,
          recovery_window_hours: cfg.recovery_window_hours,
          n_simulation_runs: withMonteCarlo ? 1000 : 0,
          seed: 42,
        },
        { signal: controller.signal },
      )
      .then((res) => {
        // Only paint if this is at least as new as what's on screen: rapid
        // dragging fires overlapping requests that can resolve out of order.
        if (seq < appliedSeqRef.current) return;
        appliedSeqRef.current = seq;
        setResult(res);
        setError(null);
        setUpdating(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return; // superseded
        setError(err instanceof Error ? err.message : "Simulation failed");
        setUpdating(false);
      });
  }, []);

  // Abort whatever is in flight / pending right now. In a callback (not
  // inline in the effect cleanup) so it reads the live ref values.
  const cancelPending = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    window.clearTimeout(settleRef.current);
    liveAbortRef.current?.abort();
    settleAbortRef.current?.abort();
  }, []);

  const scheduleRun = useCallback(
    (cfg: LiveConfig) => {
      cancelPending();
      // Fast headline pass ~now; uncertainty-band pass once the drag settles.
      debounceRef.current = window.setTimeout(() => runSimulation(cfg, false), DEBOUNCE_MS);
      settleRef.current = window.setTimeout(() => runSimulation(cfg, true), SETTLE_MS);
    },
    [cancelPending, runSimulation],
  );

  useEffect(() => {
    runSimulation(DEFAULTS, true);
    return cancelPending;
  }, [runSimulation, cancelPending]);

  const onSlider = (patch: Partial<LiveConfig>) => {
    const next = { ...configRef.current, ...patch };
    configRef.current = next;
    setConfig(next);
    scheduleRun(next);
  };

  const rve = result?.policies.find((p) => p.policy_id === "rve_adaptive") ?? null;

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Tighten the constraints, watch the strategy adapt
        </h2>
        {updating && (
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            updating…
          </span>
        )}
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
        RVE Adaptive, re-run live against the synthetic batch as you drag. Baselines shown at the same limits.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
        <RangeField
          label="Recovery budget"
          id="live-budget"
          value={config.discount_budget}
          min={0}
          max={100_000}
          step={1_000}
          format={(v) => `₹${v.toLocaleString("en-IN")}`}
          onChange={(v) => onSlider({ discount_budget: v })}
        />
        <RangeField
          label="Contact cap / customer"
          id="live-contactcap"
          value={config.max_contacts_per_customer}
          min={1}
          max={3}
          step={1}
          format={(v) => String(v)}
          hint="Engine limit is 1–3."
          onChange={(v) => onSlider({ max_contacts_per_customer: v })}
        />
        <RangeField
          label="Voice-call capacity"
          id="live-voice"
          value={config.voice_capacity}
          min={0}
          max={3_000}
          step={50}
          format={(v) => v.toLocaleString("en-IN")}
          onChange={(v) => onSlider({ voice_capacity: v })}
        />
        <RangeField
          label="Recovery window"
          id="live-window"
          value={Math.round(config.recovery_window_hours / 24)}
          min={1}
          max={14}
          step={1}
          format={(v) => `${v} day${v === 1 ? "" : "s"}`}
          onChange={(v) => onSlider({ recovery_window_hours: v * 24 })}
        />
      </div>

      <div className="mt-5 pt-5 border-t" style={{ borderColor: "var(--color-border)" }}>
        {!result || !rve ? (
          error ? (
            <p className="text-sm" style={{ color: "var(--color-status-danger-text)" }}>
              {error}
            </p>
          ) : (
            <LoadingState label="Running first simulation…" />
          )
        ) : (
          <div className="flex flex-col gap-5">
            {error && (
              <p className="text-xs" style={{ color: "var(--color-status-danger-text)" }}>
                Last update failed ({error}); showing the previous result.
              </p>
            )}
            <AllocationBar rve={rve} inScope={result.n_payments_in_scope} budget={config.discount_budget} />
            <StatCards rve={rve} budget={config.discount_budget} runs={result.n_simulation_runs} />
            <BaselineStrip policies={result.policies} />
          </div>
        )}
      </div>

      <p className="text-xs mt-4" style={{ color: "var(--color-text-muted)" }}>
        Offline simulation. No slider setting sends a real message or calls Razorpay.
      </p>
    </Card>
  );
}

function AllocationBar({
  rve,
  inScope,
  budget,
}: {
  rve: RecoveryLabPolicyMetrics;
  inScope: number;
  budget: number;
}) {
  if (inScope === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        No failed payments fall inside this recovery window.
      </p>
    );
  }

  const segments = INTERVENTION_ORDER.filter((id) => (rve.allocation[id] ?? 0) > 0);
  const noneAffordable = rve.number_intervened === 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          Intervention mix
        </h3>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {inScope.toLocaleString("en-IN")} payments in scope
        </span>
      </div>
      <div
        className="flex w-full rounded overflow-hidden"
        style={{ height: 14, background: "var(--color-bg-subtle)" }}
        role="img"
        aria-label={segments
          .map((id) => `${INTERVENTION_LABELS[id]}: ${rve.allocation[id]}`)
          .join(", ")}
      >
        {segments.map((id) => (
          <div
            key={id}
            style={{
              flexGrow: rve.allocation[id],
              flexBasis: 0,
              background: INTERVENTION_COLORS[id],
              transition: REDUCED_MOTION ? undefined : "flex-grow 300ms ease",
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <span
              className="inline-block rounded-sm"
              style={{ width: 9, height: 9, background: INTERVENTION_COLORS[id] }}
            />
            {INTERVENTION_LABELS[id]}
            <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-family-data)" }}>
              {rve.allocation[id].toLocaleString("en-IN")}
            </span>
          </span>
        ))}
      </div>
      {noneAffordable && (
        <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
          {budget === 0
            ? "No interventions are affordable at ₹0 budget — showing organic recovery only."
            : "No interventions selected under these limits — showing organic recovery only."}
        </p>
      )}
    </div>
  );
}

function StatCards({
  rve,
  budget,
  runs,
}: {
  rve: RecoveryLabPolicyMetrics;
  budget: number;
  runs: number;
}) {
  // Values snap rather than count up: this panel re-runs on every drag step,
  // so a count-up animation would perpetually chase a moving target and never
  // settle. The allocation and baseline bars carry the motion instead.
  const utilPct = budget > 0 ? Math.min(100, (rve.intervention_cost / budget) * 100) : null;
  const hasBand = rve.net_value_low !== null && rve.net_value_high !== null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Net value recovered
        </p>
        <p
          className="text-xl font-semibold mt-0.5"
          style={{ color: "var(--color-status-success-text)", fontFamily: "var(--font-family-data)" }}
        >
          {formatCurrency(Math.round(rve.net_value_created))}
        </p>
        {hasBand && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {formatCurrency(Math.round(rve.net_value_low as number))} – {formatCurrency(Math.round(rve.net_value_high as number))}{" "}
            ({runs.toLocaleString("en-IN")} runs)
          </p>
        )}
      </div>
      <div>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Recovery rate
        </p>
        <p
          className="text-xl font-semibold mt-0.5"
          style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}
        >
          {(rve.recovery_rate * 100).toFixed(1)}%
        </p>
      </div>
      <div>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Budget utilised
        </p>
        <p
          className="text-xl font-semibold mt-0.5"
          style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}
        >
          {formatCurrency(Math.round(rve.intervention_cost))}
          {utilPct !== null && (
            <span className="text-xs font-normal ml-1.5" style={{ color: "var(--color-text-muted)" }}>
              {utilPct.toFixed(0)}% of ₹{budget.toLocaleString("en-IN")}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function BaselineStrip({ policies }: { policies: RecoveryLabPolicyMetrics[] }) {
  const rve = policies.find((p) => p.policy_id === "rve_adaptive");
  const retry = policies.find((p) => p.policy_id === "always_retry");
  const nothing = policies.find((p) => p.policy_id === "no_intervention");
  if (!rve || !retry || !nothing) return null;

  const rows = [
    { label: "RVE Adaptive", value: rve.net_value_created, strong: true },
    { label: "Always retry", value: retry.net_value_created, strong: false },
    { label: "Do nothing", value: nothing.net_value_created, strong: false },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const delta = rve.net_value_created - retry.net_value_created;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          Net value vs baselines
        </h3>
        <span
          className="text-xs font-medium"
          style={{ color: delta >= 0 ? "var(--color-status-success-text)" : "var(--color-text-secondary)" }}
        >
          {delta >= 0 ? "+" : "−"}
          {formatCurrency(Math.abs(Math.round(delta)))} vs Always retry
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="text-xs w-24 shrink-0" style={{ color: "var(--color-text-secondary)" }}>
              {r.label}
            </span>
            <div className="flex-1 rounded" style={{ height: 8, background: "var(--color-bg-subtle)" }}>
              <div
                style={{
                  width: `${Math.max(0, (r.value / max) * 100)}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: r.strong ? "var(--color-status-success)" : "var(--color-chart-neutral)",
                  transition: REDUCED_MOTION ? undefined : "width 300ms ease",
                }}
              />
            </div>
            <span
              className="text-xs w-24 shrink-0 text-right"
              style={{
                color: r.strong ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontFamily: "var(--font-family-data)",
                fontWeight: r.strong ? 600 : 400,
              }}
            >
              {formatCurrency(Math.round(r.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
