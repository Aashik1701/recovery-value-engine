import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RevenueAutopsyCausesResponse, RevenueAutopsySummaryResponse } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { LoadingState, ErrorState } from "../components/PageState";
import { formatCurrency } from "../lib/format";
import { ForensicPaymentTable } from "./ForensicPaymentTable";
import { FixFirstPanel } from "./FixFirstPanel";
import { LossChain } from "./LossChain";
import { OpportunityQuadrant } from "./OpportunityQuadrant";
import { RecoveryDelayPanel } from "./RecoveryDelayPanel";
import { RootCauseBreakdown } from "./RootCauseBreakdown";

export function RevenueAutopsy() {
  const [summary, setSummary] = useState<RevenueAutopsySummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [causes, setCauses] = useState<RevenueAutopsyCausesResponse | null>(null);
  const [causesError, setCausesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .revenueAutopsySummary()
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(err instanceof Error ? err.message : "Revenue analysis unavailable.");
      });
    api
      .revenueAutopsyCauses()
      .then((res) => {
        if (!cancelled) setCauses(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCausesError(err instanceof Error ? err.message : "Revenue analysis unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasError = summaryError || causesError;

  return (
    <div className="flex flex-col gap-6 w-full">
      <Header />

      {hasError && (
        <ErrorState
          title="Revenue analysis unavailable"
          detail={summaryError ?? causesError ?? undefined}
          reassurance="Your payment and recovery workflows are unaffected."
        />
      )}

      {!hasError && !summary && <LoadingState label="Analyzing payment failures… reconstructing revenue loss chain…" />}

      {!hasError && summary && (
        <>
          <SectionLabel>Problem</SectionLabel>
          <LeakageSummary summary={summary} />

          <SectionLabel>Evidence</SectionLabel>
          <LossChain stages={summary.loss_chain} />
        </>
      )}

      {!hasError && summary && !causes && <LoadingState label="Calculating root causes… ranking opportunities…" />}

      {!hasError && summary && causes && (
        <>
          <RootCauseBreakdown causes={causes.causes} note={causes.note} />
          <RecoveryDelayPanel delay={summary.recovery_delay} />
          <ParetoCard statement={summary.pareto.statement} detected={summary.pareto.concentration_detected} />

          <SectionLabel>Opportunity</SectionLabel>
          <OpportunityQuadrant opportunities={causes.fix_first} />
          <FixFirstPanel opportunities={causes.fix_first} formulaNote={causes.formula_note} />

          <SectionLabel>Payment-level detail</SectionLabel>
          <ForensicPaymentTable causes={causes.causes} />
          <MethodologyPanel note={causes.note} />
        </>
      )}
    </div>
  );
}

/** Groups the autopsy's problem -> evidence -> opportunity -> action
 * hierarchy without wrapping every panel in its own decorated card -- a
 * section divider carries the structure the panels below it share. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wide pt-2 border-t"
      style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
    >
      {children}
    </p>
  );
}

function Header() {
  return (
    <PageHeader
      eyebrow="Revenue Intelligence"
      title="Revenue Recovery Autopsy"
      badge="Offline analysis"
      description={
        <>
          Understand where revenue was lost, why it happened, and what to fix first.
          <span className="block text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Analysis is based on synthetic/test payment and recovery data.
          </span>
        </>
      }
    />
  );
}

function LeakageSummary({ summary }: { summary: RevenueAutopsySummaryResponse }) {
  const l = summary.leakage;
  return (
    <Card>
      <div className="flex flex-wrap gap-8">
        <Stat label="Revenue at risk" value={formatCurrency(l.total_at_risk)} emphasize />
        <Stat label="Revenue lost" value={formatCurrency(l.revenue_lost)} tone="danger" />
        <Stat label="Recovered" value={formatCurrency(l.total_recovered)} tone="success" />
        <Stat label="Potentially preventable" value={formatCurrency(l.preventable_amount)} />
        <Stat label="Recoverable" value={formatCurrency(l.recoverable_amount)} />
        <Stat label="Permanently lost" value={formatCurrency(l.permanently_lost_amount)} tone="danger" />
      </div>
      <details className="mt-3 pt-3 border-t" style={{ borderColor: "var(--color-border)" }}>
        <summary className="text-xs cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
          Definitions
        </summary>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {Object.entries(l.definitions).map(([key, def]) => (
            <div key={key}>
              <dt className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
                {key.replace(/_/g, " ")}
              </dt>
              <dd className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                {def}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}

function Stat({ label, value, emphasize = false, tone }: { label: string; value: string; emphasize?: boolean; tone?: "success" | "danger" }) {
  const color = tone === "success" ? "var(--color-status-success-text)" : tone === "danger" ? "var(--color-status-danger-text)" : "var(--color-text-primary)";
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p
        className={emphasize ? "text-2xl font-semibold mt-0.5" : "text-base font-semibold mt-0.5"}
        style={{ color, fontFamily: "var(--font-family-data)" }}
      >
        {value}
      </p>
    </div>
  );
}

function ParetoCard({ statement, detected }: { statement: string; detected: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Root-cause concentration
        </p>
        <StatusBadge tone={detected ? "pending" : "neutral"}>{detected ? "Concentration detected" : "No dominant concentration"}</StatusBadge>
      </div>
      <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
        {statement}
      </p>
    </Card>
  );
}

function MethodologyPanel({ note }: { note: string }) {
  return (
    <Card>
      <details>
        <summary className="text-sm font-semibold cursor-pointer" style={{ color: "var(--color-text-primary)" }}>
          Evidence &amp; methodology
        </summary>
        <p className="text-sm mt-2" style={{ color: "var(--color-text-secondary)" }}>
          This analysis reconstructs the lifecycle of every failed payment in the current synthetic batch (checkout →
          payment attempt → method → gateway → failure → recovery → outcome), using the existing RVE audit log for
          each payment's decision and a documented synthetic layer for realized recovery outcomes and lifecycle
          timestamps that don't otherwise exist in the system. Primary causes are a direct relabeling of the recorded
          failure reason; contributing causes and preventability/opportunity figures are attributed under
          deterministic, documented rules -- never proven causality, never a production guarantee. See
          docs/REVENUE_RECOVERY_AUTOPSY.md for the full methodology and honesty boundary.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
          {note}
        </p>
      </details>
    </Card>
  );
}
