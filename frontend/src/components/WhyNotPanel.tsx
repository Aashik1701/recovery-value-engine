import type { InterventionEvaluation } from "../api/types";
import { INTERVENTION_LABELS, formatCurrency, formatProbabilityRange } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { toneForEvaluationStatus } from "./InterventionBadge";
import { Card } from "./Card";
import { Table, TableHeaderRow, Td, Th, Tr } from "./Table";
import { FlagIcon } from "./icons";

/**
 * The dashboard's core explainability surface: every alternative the
 * optimizer considered and rejected, with its EV and the specific reason it
 * lost, sourced directly from the decision's audit record, no extra
 * computation.
 */
export function WhyNotPanel({ evaluations }: { evaluations: InterventionEvaluation[] }) {
  const chosen = evaluations.find((e) => e.status === "chosen");
  const alternatives = evaluations.filter((e) => e.status !== "chosen");

  // The strongest trust moment this panel can show: a guardrail-blocked
  // alternative whose raw expected value was actually HIGHER than what was
  // chosen. Surfaced as a callout, not just a table row, because it's direct
  // proof the optimizer checks eligibility before ranking by EV, not after --
  // the system didn't pick the biggest number, it picked the biggest
  // ALLOWED number.
  const blockedButHigherEv = chosen
    ? alternatives
        .filter((e) => e.status === "blocked_by_guardrail" && e.expected_value > chosen.expected_value)
        .sort((a, b) => b.expected_value - a.expected_value)[0]
    : undefined;

  return (
    <Card padded={false}>
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Why not this action?
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
          Every alternative the optimizer considered and rejected, and why.
        </p>
      </div>

      {blockedButHigherEv && (
        <div
          className="mx-4 mb-3 px-3 py-2.5 rounded flex items-start gap-2.5"
          style={{ background: "var(--color-status-pending-bg)", border: "1px solid var(--color-status-pending-border)", borderRadius: "var(--radius-md)" }}
        >
          <span aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: "var(--color-status-pending-text)" }}>
            <FlagIcon size={14} />
          </span>
          <p className="text-xs" style={{ color: "var(--color-status-pending-text)" }}>
            <strong>{INTERVENTION_LABELS[blockedButHigherEv.intervention_id]}</strong> had the highest raw expected value{" "}
            ({formatCurrency(blockedButHigherEv.expected_value)}) — it was blocked anyway.{" "}
            {blockedButHigherEv.rejection_reason}{" "}
            The system did not choose the biggest number; it chose the biggest <em>allowed</em> number.
          </p>
        </div>
      )}

      <Table>
        <thead>
          <TableHeaderRow>
            <Th>Intervention</Th>
            <Th align="right">P(recovery)</Th>
            <Th align="right">Unit cost</Th>
            <Th align="right">EV</Th>
            <Th>Status</Th>
            <Th>Reason</Th>
          </TableHeaderRow>
        </thead>
        <tbody>
          {alternatives.map((e) => (
            <Tr key={e.intervention_id}>
              <Td>{INTERVENTION_LABELS[e.intervention_id]}</Td>
              <Td align="right" mono>
                {formatProbabilityRange(e.probability_recovery, e.probability_spread)}
              </Td>
              <Td align="right" mono>
                {formatCurrency(e.unit_cost)}
              </Td>
              <Td align="right" mono>
                {formatCurrency(e.expected_value)}
              </Td>
              <Td>
                <StatusBadge tone={toneForEvaluationStatus(e.status)}>
                  {e.status === "blocked_by_guardrail" ? "Blocked" : "Rejected"}
                </StatusBadge>
              </Td>
              <Td style={{ color: "var(--color-text-secondary)" }}>{e.rejection_reason ?? "-"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
