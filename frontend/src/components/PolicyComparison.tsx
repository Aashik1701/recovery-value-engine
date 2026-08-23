import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { EvaluateResponse, PolicyResult } from "../api/types";
import { formatCurrency } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

export function PolicyComparison() {
  const [data, setData] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .evaluate()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load evaluation");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <Card>Could not load the policy comparison: {error}</Card>;
  if (!data) return <Card>Loading evaluation…</Card>;

  const chartData = data.policies.map((p) => ({
    name: shortLabel(p.policy_label),
    net: p.net_revenue,
    isWinner: p.policy_id === "ev_optimized",
  }));

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Policy comparison
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--color-text-secondary)" }}>
          Exact expected net revenue under four policies, computed offline against the synthetic
          simulator's hidden ground truth on the same held-out batch of {data.batch_size} failed
          payments. This is an offline / simulator-based comparison, not a live A/B test — see{" "}
          <code>docs/EVALUATION.md</code>.
        </p>
      </div>

      <Card>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.isWinner ? "var(--color-status-success)" : "var(--slate-400)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card padded={false}>
        <table style={{ fontSize: "var(--table-font-size)" }}>
          <thead>
            <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
              <th className="px-3 py-2 text-left font-medium">Policy</th>
              <th className="px-3 py-2 text-right font-medium">Revenue recovered</th>
              <th className="px-3 py-2 text-right font-medium">Intervention cost</th>
              <th className="px-3 py-2 text-right font-medium">Net revenue</th>
              <th className="px-3 py-2 text-right font-medium">Net / ₹ spent</th>
            </tr>
          </thead>
          <tbody>
            {data.policies.map((p) => (
              <PolicyRow key={p.policy_id} policy={p} />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PolicyRow({ policy }: { policy: PolicyResult }) {
  const isWinner = policy.policy_id === "ev_optimized";
  return (
    <tr
      className="border-t"
      style={{
        borderColor: "var(--table-border-color)",
        background: isWinner ? "var(--color-status-success-bg)" : undefined,
      }}
    >
      <td className="px-3 py-2 font-medium" style={{ color: "var(--color-text-primary)" }}>
        <div className="flex items-center gap-2">
          {policy.policy_label}
          {isWinner && <StatusBadge tone="success">this project</StatusBadge>}
        </div>
      </td>
      <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
        {formatCurrency(policy.total_expected_revenue_recovered)}
      </td>
      <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
        {formatCurrency(policy.total_intervention_cost)}
      </td>
      <td
        className="px-3 py-2 text-right font-semibold"
        style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}
      >
        {formatCurrency(policy.net_revenue)}
      </td>
      <td className="px-3 py-2 text-right" style={{ fontFamily: "var(--font-family-data)" }}>
        {policy.net_revenue_per_rupee.toFixed(2)}x
      </td>
    </tr>
  );
}

function shortLabel(label: string): string {
  return label.replace(" (this project)", "");
}
