import type { NegotiationCandidate } from "../api/types";
import { formatCurrency, formatPercent } from "../lib/format";
import { Card } from "../components/Card";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";
import { Table, TableHeaderRow, Td, Th, Tr } from "../components/Table";

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
      <Table>
        <thead>
          <TableHeaderRow>
            <Th align="right">Incentive</Th>
            <Th align="right">Recovery</Th>
            <Th align="right">Incremental recovery</Th>
            <Th align="right">Cost</Th>
            <Th align="right">Net value</Th>
            <Th>Status</Th>
            <Th>Reason</Th>
          </TableHeaderRow>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const status = statusFor(c, optimumCandidate, minimumEffectiveIntervention);
            return (
              <Tr key={c.incentive}>
                <Td align="right" mono className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                  {formatCurrency(c.incentive)}
                </Td>
                <Td align="right" mono>
                  {c.recovery_probability !== null ? formatPercent(c.recovery_probability) : "—"}
                </Td>
                <Td align="right" mono>
                  {c.incremental_recovery !== null ? formatCurrency(c.incremental_recovery) : "—"}
                </Td>
                <Td align="right" mono>
                  {c.incentive_cost !== null && c.intervention_cost !== null ? formatCurrency(c.incentive_cost + c.intervention_cost) : "—"}
                </Td>
                <Td align="right" mono className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {c.expected_net_value !== null ? formatCurrency(c.expected_net_value) : "—"}
                </Td>
                <Td>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </Td>
                <Td style={{ color: "var(--color-text-secondary)" }}>{c.blocked_reason ?? "-"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
