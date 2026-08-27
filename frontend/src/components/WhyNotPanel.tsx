import type { InterventionEvaluation } from "../api/types";
import { INTERVENTION_LABELS, formatCurrency, formatPercent } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { toneForEvaluationStatus } from "./InterventionBadge";
import { Card } from "./Card";

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
      <table style={{ fontSize: "var(--table-font-size)" }}>
        <thead>
          <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
            <th className="px-3 py-2 text-left font-medium">Intervention</th>
            <th className="px-3 py-2 text-right font-medium">P(recovery)</th>
            <th className="px-3 py-2 text-right font-medium">Unit cost</th>
            <th className="px-3 py-2 text-right font-medium">EV</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {alternatives.map((e) => (
            <tr
              key={e.intervention_id}
              className="border-t"
              style={{ borderColor: "var(--table-border-color)" }}
            >
              <td className="px-3 py-2">{INTERVENTION_LABELS[e.intervention_id]}</td>
              <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                {formatPercent(e.probability_recovery)}
              </td>
              <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                {formatCurrency(e.unit_cost)}
              </td>
              <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                {formatCurrency(e.expected_value)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge tone={toneForEvaluationStatus(e.status)}>
                  {e.status === "blocked_by_guardrail" ? "Blocked" : "Rejected"}
                </StatusBadge>
              </td>
              <td className="px-3 py-2" style={{ color: "var(--color-text-secondary)" }}>
                {e.rejection_reason ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
