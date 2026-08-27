import type { InterventionEvaluation } from "../api/types";
import { INTERVENTION_LABELS, formatCurrency, formatPercent } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { toneForEvaluationStatus } from "./InterventionBadge";
import { Card } from "./Card";
import { Table, TableHeaderRow, Td, Th } from "./Table";

/**
 * The dashboard's core explainability surface: every alternative the
 * optimizer considered and rejected, with its EV and the specific reason it
 * lost, sourced directly from the decision's audit record, no extra
 * computation.
 */
export function WhyNotPanel({ evaluations }: { evaluations: InterventionEvaluation[] }) {
  const alternatives = evaluations.filter((e) => e.status !== "chosen");

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
            <tr key={e.intervention_id} className="border-t" style={{ height: "var(--table-row-height)", borderColor: "var(--table-border-color)" }}>
              <Td>{INTERVENTION_LABELS[e.intervention_id]}</Td>
              <Td align="right" mono>
                {formatPercent(e.probability_recovery)}
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
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
