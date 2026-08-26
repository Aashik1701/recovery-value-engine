import type { FixFirstOpportunity } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
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
        <table style={{ fontSize: "var(--table-font-size)" }}>
          <thead>
            <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
              <th className="px-3 py-2 text-left font-medium">Priority</th>
              <th className="px-3 py-2 text-left font-medium">Cause</th>
              <th className="px-3 py-2 text-right font-medium">Opportunity</th>
              <th className="px-3 py-2 text-right font-medium">Fix cost</th>
              <th className="px-3 py-2 text-right font-medium">Feasibility</th>
              <th className="px-3 py-2 text-right font-medium">Expected value of fix</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr
                key={o.cause_key}
                className="border-t"
                style={{ borderColor: "var(--table-border-color)", background: o.priority === 1 ? "var(--color-status-success-bg)" : undefined }}
              >
                <td className="px-3 py-2" style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}>
                  {o.priority}
                </td>
                <td className="px-3 py-2 font-medium" style={{ color: "var(--color-text-primary)" }}>
                  {o.label}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {formatCurrency(o.preventable_amount)}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {formatCurrency(o.estimated_fix_cost)}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {o.feasibility.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
                  {formatCurrency(o.expected_value_of_fix)}
                </td>
                <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}>
                  {o.opportunity_score.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
