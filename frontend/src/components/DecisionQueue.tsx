import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision, FailureReason, InterventionEvaluation, InterventionId, RevenueAutopsySummaryResponse } from "../api/types";
import { FAILURE_REASON_LABELS, formatCurrency, formatPercent, formatProbabilityRange } from "../lib/format";
import { ConfidenceTag } from "./ConfidenceTag";
import { InterventionBadge } from "./InterventionBadge";
import { Card } from "./Card";
import { PageHeader } from "./PageHeader";
import { StatTile, StatTileGrid } from "./StatTile";
import { StatusBadge } from "./StatusBadge";
import { Table, TableHeaderRow, Td, Th, Tr } from "./Table";
import { LoadingState, ErrorState, EmptyState } from "./PageState";

/** One row's derived economics -- computed entirely from data the decision
 * already carries (no fabricated number, no extra API call). "Net value"
 * mirrors Recovery Lab's own definition (incremental_recovery - cost): the
 * chosen intervention's EV minus what no_action alone would have been worth,
 * since no_action's EV is P(no_action) * amount - 0, so this nets out
 * exactly the *incremental* value the chosen action creates. */
function deriveRow(d: Decision) {
  const chosen = d.evaluations.find((e) => e.status === "chosen");
  const noAction = d.evaluations.find((e) => e.intervention_id === "no_action");
  const netValue = chosen ? chosen.expected_value - (noAction?.expected_value ?? 0) : 0;

  // The single strongest "why not" moment for this row: a blocked
  // alternative whose raw EV was actually higher than what was chosen --
  // proof the optimizer checked eligibility before picking the top number,
  // not after.
  const blockedButHigherEv = d.evaluations
    .filter((e): e is InterventionEvaluation => e.status === "blocked_by_guardrail" && chosen !== undefined && e.expected_value > chosen.expected_value)
    .sort((a, b) => b.expected_value - a.expected_value)[0];

  const isGuardrailLimited = blockedButHigherEv !== undefined;

  return { chosen, netValue, blockedButHigherEv, isGuardrailLimited };
}

export function DecisionQueue() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [summary, setSummary] = useState<RevenueAutopsySummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<FailureReason | "all">("all");
  const [interventionFilter, setInterventionFilter] = useState<InterventionId | "all">("all");
  const navigate = useNavigate();

  const [loadSeq, setLoadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listDecisions(1, 200)
      .then((res) => {
        if (!cancelled) setDecisions(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load decisions");
      });
    // The leakage summary is genuinely nice-to-have for the top metric strip
    // (Revenue Autopsy already computes it) -- a failure here must not block
    // the opportunity queue itself from rendering, so it's a separate,
    // independently-erroring fetch, not part of the Promise chain above.
    api
      .revenueAutopsySummary()
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(err instanceof Error ? err.message : "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [loadSeq]);

  const filtered = useMemo(() => {
    if (!decisions) return [];
    const withReason = decisions.filter((d) => {
      if (reasonFilter !== "all" && d.failure_reason !== reasonFilter) return false;
      if (interventionFilter !== "all" && d.chosen_intervention !== interventionFilter) return false;
      return true;
    });
    // Sort by highest expected NET value, not amount -- a ₹500 payment with
    // an 80% recovery probability can easily outrank a ₹5,000 payment stuck
    // with a 5% one, and that's the whole point of this queue.
    return withReason
      .map((d) => ({ decision: d, ...deriveRow(d) }))
      .sort((a, b) => b.netValue - a.netValue);
  }, [decisions, reasonFilter, interventionFilter]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load recovery opportunities"
        detail={error}
        reassurance="Check that the backend is running and try again."
        onRetry={() => setLoadSeq((n) => n + 1)}
      />
    );
  }

  if (!decisions) {
    return <LoadingState label="Loading recovery opportunities…" />;
  }

  const l = summary?.leakage;
  const recoveryRate = l && l.total_at_risk > 0 ? l.total_recovered / l.total_at_risk : null;
  const netValueCreated = decisions.reduce((sum, d) => sum + deriveRow(d).netValue, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Revenue Recovery"
        title="Recovery Opportunities"
        badge="Model-based estimate"
        description={
          <>
            AI-powered payment recovery intelligence — every failed payment, ranked by net value created, not raw amount.
            <span className="block text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              Figures below are offline / simulator-based, computed from this batch's decisions and forensic analysis — not live production revenue. See{" "}
              <code>docs/JUDGE_EVIDENCE.md</code>.
            </span>
          </>
        }
      />

      <Card>
        {summaryError && !l ? (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Leakage summary unavailable ({summaryError}) — the opportunity queue below is unaffected.
          </p>
        ) : (
          <StatTileGrid cols={5}>
            <StatTile label="Revenue at risk" value={l ? formatCurrency(l.total_at_risk) : "—"} tone={l && l.total_at_risk > 0 ? "danger" : undefined} />
            <StatTile label="Recoverable revenue" value={l ? formatCurrency(l.recoverable_amount) : "—"} tone="pending" />
            <StatTile label="Recovered" value={l ? formatCurrency(l.total_recovered) : "—"} tone="success" />
            <StatTile label="Recovery rate" value={recoveryRate !== null ? formatPercent(recoveryRate) : "—"} />
            <StatTile label="Net value created" value={formatCurrency(netValueCreated)} context="This queue, EV-optimized vs. no action" />
          </StatTileGrid>
        )}
      </Card>

      <PageHeader
        title="Highest-value opportunities"
        description={`${filtered.length} of ${decisions.length} decisions shown, sorted by net value created`}
        action={
          <div className="flex items-center gap-2">
            <FilterSelect
              ariaLabel="Filter by failure reason"
              value={reasonFilter}
              onChange={(v) => setReasonFilter(v as FailureReason | "all")}
              options={[
                { value: "all", label: "All failure reasons" },
                ...(Object.keys(FAILURE_REASON_LABELS) as FailureReason[]).map((r) => ({
                  value: r,
                  label: FAILURE_REASON_LABELS[r],
                })),
              ]}
            />
            <FilterSelect
              ariaLabel="Filter by recommended intervention"
              value={interventionFilter}
              onChange={(v) => setInterventionFilter(v as InterventionId | "all")}
              options={[
                { value: "all", label: "All interventions" },
                { value: "no_action", label: "No action" },
                { value: "retry_now", label: "Retry now" },
                { value: "retry_later", label: "Retry later" },
                { value: "sms_link", label: "SMS link" },
                { value: "whatsapp_nudge", label: "WhatsApp nudge" },
                { value: "email", label: "Email" },
                { value: "voice_call", label: "Voice call" },
              ]}
            />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          title="No recovery opportunities match the current filters"
          description="Clear a filter above, or run a fresh /simulate batch."
        />
      ) : (
        <Card padded={false}>
          <Table style={{ width: "100%", minWidth: 900 }}>
            <thead>
              <TableHeaderRow>
                <Th>Payment</Th>
                <Th align="right">Amount</Th>
                <Th>Failure</Th>
                <Th>History</Th>
                <Th>Recommended action</Th>
                <Th align="right">Net value created</Th>
                <Th>Guardrail</Th>
                <Th>Status</Th>
              </TableHeaderRow>
            </thead>
            <tbody>
              {filtered.map(({ decision: d, chosen, netValue, blockedButHigherEv, isGuardrailLimited }) => (
                <Tr key={d.decision_id} onClick={() => navigate(`/dashboard/decisions/${d.payment_id}`)}>
                  <Td mono>{d.payment_id}</Td>
                  <Td align="right" mono>
                    {formatCurrency(d.amount)}
                  </Td>
                  <Td>{FAILURE_REASON_LABELS[d.failure_reason]}</Td>
                  <Td style={{ color: "var(--color-text-muted)" }}>
                    {d.retry_count_so_far === 0 ? "First attempt" : `${d.retry_count_so_far} ${d.retry_count_so_far === 1 ? "retry" : "retries"}`}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {d.escalated ? (
                        <StatusBadge tone="pending">⚑ Escalated</StatusBadge>
                      ) : (
                        <InterventionBadge interventionId={d.chosen_intervention as InterventionId} />
                      )}
                      <ConfidenceTag tier={d.confidence_tier} compact />
                    </div>
                  </Td>
                  <Td align="right" mono>
                    <div>{formatCurrency(netValue)}</div>
                    {chosen && (
                      <div className="text-[11px] font-normal mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                        {formatProbabilityRange(chosen.probability_recovery, chosen.probability_spread)} · cost{" "}
                        {formatCurrency(chosen.unit_cost)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {blockedButHigherEv ? (
                      <span
                        title={`${blockedButHigherEv.rejection_reason ?? "Blocked by a guardrail"} (raw EV ${formatCurrency(
                          blockedButHigherEv.expected_value,
                        )}, higher than the chosen action)`}
                      >
                        <StatusBadge tone="danger">
                          {(() => {
                            const label = blockedButHigherEv.intervention_id === "voice_call" ? "Voice" : blockedButHigherEv.intervention_id.replace(/_/g, " ");
                            return `${label} blocked`;
                          })()}
                        </StatusBadge>
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge tone={d.escalated || isGuardrailLimited ? "pending" : "success"}>
                      {d.escalated ? "Escalated" : isGuardrailLimited ? "Guardrail-limited" : "EV-optimal"}
                    </StatusBadge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      className="text-sm rounded border px-2 py-1.5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
