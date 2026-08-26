import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RecoveryLabPolicyMetrics } from "../api/types";
import { formatCurrency } from "../lib/format";
import { Card } from "../components/Card";

/**
 * "Policy frontier": intervention cost (x) vs incremental recovery (y) for
 * all four simulated policies at once. The point that ALSO has the highest
 * net value (incremental - cost) is highlighted -- not necessarily
 * RVE Adaptive; CLAUDE.md's Recovery Lab task, Section 17, is explicit that
 * a different policy winning must be shown, not hidden.
 */
export function PolicyFrontierChart({ policies }: { policies: RecoveryLabPolicyMetrics[] }) {
  const winnerId = policies.reduce((best, p) => (p.net_value_created > best.net_value_created ? p : best), policies[0])
    .policy_id;

  const data = policies.map((p) => ({
    x: p.intervention_cost,
    y: p.incremental_recovery,
    name: p.policy_label,
    net: p.net_value_created,
    isWinner: p.policy_id === winnerId,
  }));

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Policy frontier
        </h3>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          More intervention does not always create more value
        </span>
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="x"
              type="number"
              name="Intervention cost"
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              tickFormatter={(v: number) => `₹${v.toLocaleString("en-IN")}`}
              label={{ value: "Intervention cost", position: "insideBottom", offset: -4, fontSize: 11, fill: "var(--color-text-muted)" }}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="Incremental recovery"
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              label={{ value: "Incremental recovery", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--color-text-muted)" }}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div
                    className="text-xs rounded px-2.5 py-2"
                    style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
                  >
                    <p className="font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                      {d.name}
                    </p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Cost: {formatCurrency(d.x)}</p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Incremental: {formatCurrency(d.y)}</p>
                    <p style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>Net value: {formatCurrency(d.net)}</p>
                  </div>
                );
              }}
            />
            <Scatter data={data} shape="circle">
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.isWinner ? "var(--color-status-success)" : "var(--slate-400)"}
                  r={entry.isWinner ? 7 : 5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {data.map((d) => (
          <span key={d.name} className="text-xs flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: d.isWinner ? "var(--color-status-success)" : "var(--slate-400)" }}
            />
            {d.name}
            {d.isWinner && <span style={{ color: "var(--color-status-success-text)" }}>(highest net value)</span>}
          </span>
        ))}
      </div>
    </Card>
  );
}
