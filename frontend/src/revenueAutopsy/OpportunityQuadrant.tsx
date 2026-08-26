import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { FixFirstOpportunity } from "../api/types";
import { Card } from "../components/Card";
import { formatCurrency } from "../lib/format";

/**
 * Fix cost (x) vs preventable revenue opportunity (y) for every opportunity
 * bucket -- patterned directly on recoveryLab/PolicyFrontierChart.tsx's
 * styling. The top-ranked Fix-First pick is highlighted, not necessarily
 * the cheapest or the largest -- whichever the transparent opportunity-score
 * formula actually ranks first.
 */
export function OpportunityQuadrant({ opportunities }: { opportunities: FixFirstOpportunity[] }) {
  const medianCost = median(opportunities.map((o) => o.estimated_fix_cost));
  const medianOpportunity = median(opportunities.map((o) => o.preventable_amount));
  const topKey = opportunities[0]?.cause_key;

  const data = opportunities.map((o) => ({
    x: o.estimated_fix_cost,
    y: o.preventable_amount,
    name: o.label,
    priority: o.priority,
    isTop: o.cause_key === topKey,
    quickWin: o.estimated_fix_cost <= medianCost && o.preventable_amount >= medianOpportunity,
  }));

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Opportunity quadrant
        </h2>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Low cost, high opportunity is the target quadrant
        </span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 12, right: 16, left: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="x"
              type="number"
              name="Estimated fix cost"
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              label={{ value: "Estimated fix cost (illustrative)", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--color-text-muted)" }}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="Preventable revenue"
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              label={{ value: "Preventable revenue", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="text-xs rounded px-2.5 py-2" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                    <p className="font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                      #{d.priority} {d.name}
                    </p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Fix cost: {formatCurrency(d.x)}</p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Preventable: {formatCurrency(d.y)}</p>
                    {d.quickWin && <p style={{ color: "var(--color-status-success-text)", fontWeight: 600 }}>Quick win</p>}
                  </div>
                );
              }}
            />
            <Scatter data={data} shape="circle">
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.isTop ? "var(--color-status-success)" : entry.quickWin ? "var(--color-primary)" : "var(--slate-400)"}
                  r={entry.isTop ? 8 : 6}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <Legend swatch="var(--color-status-success)" label="Top Fix-First pick" />
        <Legend swatch="var(--color-primary)" label="Quick win (below-median cost, above-median opportunity)" />
        <Legend swatch="var(--slate-400)" label="Strategic fix" />
      </div>
    </Card>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: swatch }} />
      {label}
    </span>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
