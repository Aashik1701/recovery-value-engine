import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { TimingPreviewResponse, TimingPreviewScenarioId } from "../api/types";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { LoadingState, ErrorState } from "../components/PageState";
import { SegmentedControl } from "../components/SegmentedControl";
import { StatusBadge } from "../components/StatusBadge";
import { Table, TableHeaderRow, Td, Th, Tr } from "../components/Table";
import { FAILURE_REASON_LABELS, INTERVENTION_LABELS, formatCurrency, formatPercent } from "../lib/format";

const SCENARIOS: { value: TimingPreviewScenarioId; label: string }[] = [
  { value: "insufficient_funds_wait", label: "Insufficient funds — wait" },
  { value: "bank_timeout_now", label: "Bank timeout — act now" },
  { value: "card_expired_flat", label: "Card expired — timing irrelevant" },
];

/**
 * Optimal Recovery Timing -- heuristic PREVIEW only, not a shipped feature.
 * Every recovery decision has three questions: whether to recover
 * (DecisionQueue/DecisionDrillDown), what action to take (same), and when
 * to take it (this panel, preview only) -- kept visually separate here, not
 * collapsed into one opaque recommendation. See docs/ROADMAP.md for what
 * full implementation requires.
 *
 * Calls GET /decide/demo/timing-preview/{scenario} -- a standalone endpoint
 * over hardcoded demo scenarios, never the live batch or optimizer. Reuses
 * WhyNotPanel's visual pattern (Card + Table of every candidate) for the
 * "why this time, not another" table, rather than a new component style.
 */
export function TimingPreviewPanel() {
  const [scenario, setScenario] = useState<TimingPreviewScenarioId>("insufficient_funds_wait");
  const [data, setData] = useState<TimingPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .timingPreview(scenario)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load timing preview");
      });
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <PageHeader
        eyebrow="Roadmap preview"
        title="Optimal Recovery Timing"
        description={
          <>
            Not a shipped feature — a heuristic preview of action × timing joint optimization, using
            domain-informed illustrative curves instead of a fitted model.
            <span className="block text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              See <code>docs/ROADMAP.md</code> for what full implementation requires.
            </span>
          </>
        }
      />

      <Card>
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
          Demo scenario
        </p>
        <SegmentedControl
          ariaLabel="Timing preview demo scenario"
          fullWidth={false}
          options={SCENARIOS}
          value={scenario}
          onChange={(v) => setScenario(v as TimingPreviewScenarioId)}
        />
      </Card>

      {error && (
        <ErrorState
          title="Unable to load timing preview"
          detail={error}
          reassurance="Check that the backend is running and try again."
        />
      )}
      {!error && !data && <LoadingState label="Loading timing preview…" />}

      {data && (
        <>
          <Card>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                    {FAILURE_REASON_LABELS[data.failure_reason]} — {formatCurrency(data.amount)}
                  </h2>
                  <PreviewBadge />
                </div>
                <p className="text-xs mt-1 max-w-xl" style={{ color: "var(--color-text-secondary)" }}>
                  {data.description}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Action (already decided)
                </p>
                <p className="text-sm font-medium mt-0.5" style={{ color: "var(--color-text-primary)" }}>
                  {INTERVENTION_LABELS[data.action_intervention_id]}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--color-text-muted)" }}>
                Recommended timing
              </p>
              <p
                className="text-2xl font-semibold mt-0.5"
                style={{ color: "var(--color-status-success-text)", fontFamily: "var(--font-family-data)" }}
              >
                {data.recommended_bucket_label}
              </p>
            </div>

            {!data.timing_lever_relevant && data.timing_not_the_lever_note && (
              <div
                className="mt-3 px-3 py-2.5 rounded flex items-start gap-2.5"
                style={{
                  background: "var(--color-status-pending-bg)",
                  border: "1px solid var(--color-status-pending-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <span aria-hidden="true" style={{ color: "var(--color-status-pending-text)", fontSize: 14, lineHeight: 1 }}>
                  ⚑
                </span>
                <p className="text-xs" style={{ color: "var(--color-status-pending-text)" }}>
                  {capitalizeFirst(data.timing_not_the_lever_note)}
                </p>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Why this time, not another?
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                Every timing bucket the heuristic considered, with its illustrative recovery probability and EV.
              </p>
            </div>
            <Table>
              <thead>
                <TableHeaderRow>
                  <Th>Timing</Th>
                  <Th align="right">P(recovery)</Th>
                  <Th align="right">EV</Th>
                  <Th>Status</Th>
                </TableHeaderRow>
              </thead>
              <tbody>
                {data.candidates.map((c) => (
                  <Tr key={c.bucket_id} style={{ background: c.is_recommended ? "var(--color-status-success-bg)" : undefined }}>
                    <Td className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                      {c.bucket_label}
                    </Td>
                    <Td align="right" mono>
                      {formatPercent(c.probability_of_recovery)}
                    </Td>
                    <Td align="right" mono>
                      {formatCurrency(c.expected_value)}
                    </Td>
                    <Td>
                      {c.is_recommended ? (
                        <StatusBadge tone="success">Recommended</StatusBadge>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <p className="text-xs max-w-2xl" style={{ color: "var(--color-text-muted)" }}>
            {data.note}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A third, distinct badge state -- illustrative/not-fitted -- separate from
 * the Mock-data/Live-backend badge in Layout.tsx's header. Conflating "mock
 * data" with "heuristic, not yet learned" would blur two different honesty
 * claims, so this is never rendered next to or instead of that badge.
 */
function PreviewBadge() {
  return (
    <span title="Illustrative heuristic curves, not a fitted model — a different claim from the Mock data / Live backend indicator in the header.">
      <StatusBadge tone="pending">Preview — heuristic, not fitted</StatusBadge>
    </span>
  );
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
