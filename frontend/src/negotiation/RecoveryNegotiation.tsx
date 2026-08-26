import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { NegotiationAnalyzeResponse } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { FAILURE_REASON_LABELS, INTERVENTION_LABELS, formatCurrency, formatPercent } from "../lib/format";
import { buildExplanation, computeMarginProtected, selectOutcomes } from "../mocks/negotiationFixtures";
import { NegotiationCharts } from "./NegotiationCharts";
import { NegotiationComparisonTable } from "./NegotiationComparisonTable";
import { PaymentSelector } from "./PaymentSelector";

const TOLERANCE_OPTIONS = [0.9, 0.95, 0.98];

export function RecoveryNegotiation() {
  // The URL is the single source of truth for which payment is selected --
  // derived directly from searchParams on every render (not seeded into a
  // separate useState only at mount) so the page reacts correctly to browser
  // back/forward navigation and external deep links while already mounted,
  // not just to in-app PaymentSelector clicks.
  const [searchParams, setSearchParams] = useSearchParams();
  const paymentId = searchParams.get("paymentId");

  const [result, setResult] = useState<NegotiationAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(0.95);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    setResult(null);
    setLoading(true);
    setError(null);
    api
      .recoveryNegotiationAnalyze({ payment_id: paymentId })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setTolerance(res.optimization_tolerance);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Recovery negotiation is temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  function handleSelect(id: string) {
    setSearchParams({ paymentId: id });
  }

  // Tolerance changes recompute minimum_effective_intervention/margin_protected
  // LOCALLY from the already-fetched candidate curve -- no new network call
  // (Section 24/25 of the spec: one request returns the whole curve).
  const liveOutcomes = useMemo(() => {
    if (!result) return null;
    const outcomes = selectOutcomes(result.candidates, tolerance);
    const marginProtected = computeMarginProtected(result.candidates, outcomes.minimumEffectiveIntervention);
    const explanation = buildExplanation(result.candidates, outcomes.optimum, outcomes.minimumEffectiveIntervention, tolerance);
    return { ...outcomes, marginProtected, explanation };
  }, [result, tolerance]);

  const [whatIfIncentive, setWhatIfIncentive] = useState<number | null>(null);
  useEffect(() => {
    setWhatIfIncentive(liveOutcomes?.minimumEffectiveIntervention ?? null);
  }, [liveOutcomes?.minimumEffectiveIntervention]);

  const eligibleCandidates = result?.candidates.filter((c) => c.eligible) ?? [];
  const whatIfCandidate = eligibleCandidates.find((c) => c.incentive === whatIfIncentive) ?? null;
  const optimumEv = eligibleCandidates.find((c) => c.incentive === liveOutcomes?.optimum)?.expected_net_value ?? null;
  const minimumEffectiveEv =
    eligibleCandidates.find((c) => c.incentive === liveOutcomes?.minimumEffectiveIntervention)?.expected_net_value ?? null;

  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <Header />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        <PaymentSelector selectedPaymentId={paymentId} onSelect={handleSelect} />

        <div className="flex flex-col gap-5 min-w-0">
          {!paymentId && (
            <Card>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Select a payment on the left to find the minimum incentive that captures the maximum expected
                recovery value.
              </p>
            </Card>
          )}

          {loading && <Card>Analyzing recovery economics… Evaluating intervention levels… Finding minimum effective intervention…</Card>}

          {error && (
            <Card>
              <p style={{ color: "var(--color-status-danger-text)" }}>{error}</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                Your existing payment and recovery workflows are unaffected.
              </p>
            </Card>
          )}

          {result && liveOutcomes && (
            <>
              <PaymentContext result={result} />

              <ToleranceControl tolerance={tolerance} onChange={setTolerance} />

              <ResultPanel result={result} liveOutcomes={liveOutcomes} optimumEv={optimumEv} />

              <WhatIfSlider
                candidates={eligibleCandidates}
                selected={whatIfCandidate}
                onChange={setWhatIfIncentive}
                minimumEffectiveIntervention={liveOutcomes.minimumEffectiveIntervention}
                minimumEffectiveEv={minimumEffectiveEv}
              />

              <NegotiationCharts
                candidates={result.candidates}
                maxRecoveryProbabilityCandidate={liveOutcomes.maxRecoveryProbability}
                optimumCandidate={liveOutcomes.optimum}
                minimumEffectiveIntervention={liveOutcomes.minimumEffectiveIntervention}
              />

              <NegotiationComparisonTable
                candidates={result.candidates}
                optimumCandidate={liveOutcomes.optimum}
                minimumEffectiveIntervention={liveOutcomes.minimumEffectiveIntervention}
              />

              <Card>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{result.note}</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
          Recovery Negotiation
        </p>
        <StatusBadge tone="neutral">Offline analysis</StatusBadge>
      </div>
      <h1 className="text-xl font-semibold" style={{ color: "var(--color-text-primary)" }}>
        Minimum Effective Intervention
      </h1>
      <p className="text-sm mt-1 max-w-2xl" style={{ color: "var(--color-text-secondary)" }}>
        Find the minimum intervention that maximizes expected recovery value.
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
        Results are model-based estimates using synthetic/test data.
      </p>
    </div>
  );
}

function PaymentContext({ result }: { result: NegotiationAnalyzeResponse }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            PAYMENT #{result.payment_id}
          </p>
          <p className="mt-1 font-semibold" style={{ fontFamily: "var(--font-family-data)", fontSize: 26, color: "var(--color-text-primary)" }}>
            {formatCurrency(result.amount)}
          </p>
        </div>
        <div className="flex gap-6">
          <Field label="Failure">{FAILURE_REASON_LABELS[result.failure_reason]}</Field>
          <Field label="Base intervention (RVE)">{INTERVENTION_LABELS[result.base_intervention]}</Field>
          <Field label="Current RVE EV">{formatCurrency(result.base_expected_value)}</Field>
        </div>
      </div>
      <Link to={`/payments/${result.payment_id}`} className="text-xs mt-3 inline-block" style={{ color: "var(--color-primary)" }}>
        View full payment detail →
      </Link>
    </Card>
  );
}

function ToleranceControl({ tolerance, onChange }: { tolerance: number; onChange: (t: number) => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
            Optimization tolerance
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Lowest intervention within this share of maximum expected net value.
          </p>
        </div>
        <div role="radiogroup" className="inline-flex rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          {TOLERANCE_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={t === tolerance}
              onClick={() => onChange(t)}
              className="text-xs font-medium py-1.5 px-3 transition-colors"
              style={{
                background: t === tolerance ? "var(--color-primary-subtle)" : "var(--color-bg-surface)",
                color: t === tolerance ? "var(--color-primary)" : "var(--color-text-secondary)",
                borderLeft: t === TOLERANCE_OPTIONS[0] ? "none" : "1px solid var(--color-border)",
              }}
            >
              {(t * 100).toFixed(0)}%
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ResultPanel({
  result,
  liveOutcomes,
  optimumEv,
}: {
  result: NegotiationAnalyzeResponse;
  liveOutcomes: {
    maxRecoveryProbability: number | null;
    optimum: number | null;
    minimumEffectiveIntervention: number | null;
    marginProtected: number | null;
    explanation: string;
  };
  optimumEv: number | null;
}) {
  const eligibleCandidates = result.candidates.filter((c) => c.eligible);
  const meiCandidate = eligibleCandidates.find((c) => c.incentive === liveOutcomes.minimumEffectiveIntervention);
  const maxProbCandidate = eligibleCandidates.find((c) => c.incentive === liveOutcomes.maxRecoveryProbability);

  return (
    <Card>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <OutcomeStat
          label="MAX RECOVERY"
          value={maxProbCandidate ? formatCurrency(maxProbCandidate.incentive) : "—"}
          sub={maxProbCandidate ? `${formatPercent(maxProbCandidate.recovery_probability ?? 0)} recovery` : undefined}
          tone="pending"
        />
        <OutcomeStat
          label="MAX NET VALUE"
          value={liveOutcomes.optimum !== null ? formatCurrency(liveOutcomes.optimum) : "—"}
          sub={optimumEv !== null ? formatCurrency(optimumEv) : undefined}
          tone="primary"
        />
        <OutcomeStat
          label="MINIMUM EFFECTIVE"
          value={liveOutcomes.minimumEffectiveIntervention !== null ? formatCurrency(liveOutcomes.minimumEffectiveIntervention) : "—"}
          sub={meiCandidate ? formatCurrency(meiCandidate.expected_net_value ?? 0) : undefined}
          tone="success"
          emphasize
        />
      </div>

      {liveOutcomes.marginProtected !== null && (
        <p className="text-xs mt-3 pt-3 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
          Margin protected: <strong style={{ color: "var(--color-text-primary)" }}>{formatCurrency(liveOutcomes.marginProtected)}</strong> saved
          versus the next more aggressive incentive level.
        </p>
      )}

      <p className="text-sm mt-3 pt-3 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
        {liveOutcomes.explanation}
      </p>
    </Card>
  );
}

function OutcomeStat({
  label,
  value,
  sub,
  tone,
  emphasize = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "pending" | "primary" | "success";
  emphasize?: boolean;
}) {
  const color = tone === "primary" ? "var(--color-primary)" : `var(--color-status-${tone}-text)`;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p className={emphasize ? "text-2xl font-semibold mt-1" : "text-xl font-semibold mt-1"} style={{ fontFamily: "var(--font-family-data)", color }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function WhatIfSlider({
  candidates,
  selected,
  onChange,
  minimumEffectiveIntervention,
  minimumEffectiveEv,
}: {
  candidates: NegotiationAnalyzeResponse["candidates"];
  selected: NegotiationAnalyzeResponse["candidates"][number] | null;
  onChange: (incentive: number) => void;
  minimumEffectiveIntervention: number | null;
  minimumEffectiveEv: number | null;
}) {
  if (candidates.length === 0 || !selected) return null;
  const incentives = candidates.map((c) => c.incentive);
  const min = Math.min(...incentives);
  const max = Math.max(...incentives);
  const step = incentives.length > 1 ? incentives[1] - incentives[0] : 1;
  // Diff is relative to the RECOMMENDED (minimum effective) level's own EV,
  // not the true optimum -- so the slider reads 0 exactly when it sits on
  // the recommendation, and shows the real gain/loss of deviating from it.
  const diffFromRecommended =
    selected.expected_net_value !== null && minimumEffectiveEv !== null ? selected.expected_net_value - minimumEffectiveEv : null;

  return (
    <Card>
      <p className="text-sm font-medium mb-3" style={{ color: "var(--color-text-primary)" }}>
        What if we offered a different incentive?
      </p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={selected.incentive}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--color-primary)" }}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
        <Field label="Incentive">{formatCurrency(selected.incentive)}</Field>
        <Field label="Recovery probability">{selected.recovery_probability !== null ? formatPercent(selected.recovery_probability) : "—"}</Field>
        <Field label="Expected net value">{selected.expected_net_value !== null ? formatCurrency(selected.expected_net_value) : "—"}</Field>
        <Field label="Vs. minimum effective">
          {diffFromRecommended !== null ? (
            <span style={{ color: diffFromRecommended < 0 ? "var(--color-status-danger-text)" : "var(--color-text-primary)" }}>
              {diffFromRecommended >= 0 ? "+" : ""}
              {formatCurrency(diffFromRecommended)}
            </span>
          ) : (
            "—"
          )}
        </Field>
      </div>
      {selected.incentive !== minimumEffectiveIntervention && (
        <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
          A larger incentive can recover more customers but create less net value than the minimum effective level.
        </p>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd className="mt-0.5 text-sm" style={{ color: "var(--color-text-primary)" }}>{children}</dd>
    </div>
  );
}
