import type { FixFirstOpportunity } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { Table, TableHeaderRow, Td, Th } from "../components/Table";
import { formatCurrency } from "../lib/format";

export function FixFirstPanel({ opportunities, formulaNote }: { opportunities: FixFirstOpportunity[]; formulaNote: string }) {
  const top = opportunities[0];

  return (
    <div className="flex flex-col gap-4">
      {top && (
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
              Fix this first
            </p>
            <StatusBadge tone="success">#1 priority</StatusBadge>
          </div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {top.label}
          </h2>
          <div className="flex flex-wrap gap-8 mt-3">
            <Stat label="Potential opportunity" value={formatCurrency(top.preventable_amount)} emphasize />
            <Stat label="Revenue affected" value={formatCurrency(top.revenue_affected)} />
            <Stat label="Estimated fix cost" value={formatCurrency(top.estimated_fix_cost)} />
            <Stat label="Opportunity score" value={top.opportunity_score.toFixed(4)} />
          </div>
          <p className="text-sm mt-3 pt-3 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
            {top.why}
          </p>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-4 pt-3.5 pb-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Fix priority ranking
          </h3>
        </div>
        <Table>
          <thead>
            <TableHeaderRow>
              <Th>Priority</Th>
              <Th>Cause</Th>
              <Th align="right">Opportunity</Th>
              <Th align="right">Fix cost</Th>
              <Th align="right">Feasibility</Th>
              <Th align="right">Expected value of fix</Th>
              <Th align="right">Score</Th>
            </TableHeaderRow>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr
                key={o.cause_key}
                className="border-t"
                style={{ height: "var(--table-row-height)", borderColor: "var(--table-border-color)", background: o.priority === 1 ? "var(--color-status-success-bg)" : undefined }}
              >
                <Td mono>{o.priority}</Td>
                <Td className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                  {o.label}
                </Td>
                <Td align="right" mono>
                  {formatCurrency(o.preventable_amount)}
                </Td>
                <Td align="right" mono>
                  {formatCurrency(o.estimated_fix_cost)}
                </Td>
                <Td align="right" mono>
                  {o.feasibility.toFixed(1)}
                </Td>
                <Td align="right" mono>
                  {formatCurrency(o.expected_value_of_fix)}
                </Td>
                <Td align="right" mono className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {o.opportunity_score.toFixed(4)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs px-4 py-3 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
          {formulaNote}
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p
        className={emphasize ? "text-2xl font-semibold mt-0.5" : "text-sm font-medium mt-0.5"}
        style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}
      >
        {value}
      </p>
    </div>
  );
}
