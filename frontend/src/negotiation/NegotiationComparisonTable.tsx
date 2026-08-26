import type { NegotiationCandidate } from "../api/types";
import { formatCurrency, formatPercent } from "../lib/format";
import { Card } from "../components/Card";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";

function statusFor(
  candidate: NegotiationCandidate,
  optimumCandidate: number | null,
  minimumEffectiveIntervention: number | null,
): { label: string; tone: StatusTone } {
  if (!candidate.eligible) return { label: "Blocked", tone: "danger" };
  if (candidate.incentive === minimumEffectiveIntervention) return { label: "RECOMMENDED", tone: "success" };
  if (candidate.incentive === optimumCandidate) return { label: "Max net value", tone: "pending" };
  return { label: "Eligible", tone: "neutral" };
}

/** One row per candidate incentive level, including blocked ones -- every
 * point on the curve must come from the backend, nothing decorative. */
export function NegotiationComparisonTable({
  candidates,
  optimumCandidate,
  minimumEffectiveIntervention,
}: {
  candidates: NegotiationCandidate[];
  optimumCandidate: number | null;
  minimumEffectiveIntervention: number | null;
}) {
  return (
    <Card padded={false}>
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Intervention intensity comparison
        </h2>
      </div>
      <table style={{ fontSize: "var(--table-font-size)" }}>
        <thead>
          <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
            <th className="px-3 py-2 text-right font-medium">Incentive</th>
            <th className="px-3 py-2 text-right font-medium">Recovery</th>
            <th className="px-3 py-2 text-right font-medium">Incremental recovery</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Net value</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const status = statusFor(c, optimumCandidate, minimumEffectiveIntervention);
            return (
              <tr key={c.incentive} className="border-t" style={{ borderColor: "var(--table-border-color)" }}>
                <td className="px-3 py-2 text-right font-medium" style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}>
                  {formatCurrency(c.incentive)}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {c.recovery_probability !== null ? formatPercent(c.recovery_probability) : "—"}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {c.incremental_recovery !== null ? formatCurrency(c.incremental_recovery) : "—"}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {c.incentive_cost !== null && c.intervention_cost !== null ? formatCurrency(c.incentive_cost + c.intervention_cost) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}>
                  {c.expected_net_value !== null ? formatCurrency(c.expected_net_value) : "—"}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </td>
                <td className="px-3 py-2" style={{ color: "var(--color-text-secondary)" }}>
                  {c.blocked_reason ?? "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
