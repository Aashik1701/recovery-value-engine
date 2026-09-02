import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { EvaluateResponse, PolicyResult } from "../api/types";
import { formatCurrency, formatCurrencyCompact } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";
import { PageHeader } from "./PageHeader";
import { LoadingState, ErrorState } from "./PageState";
import { Table, TableHeaderRow, Td, Th, Tr } from "./Table";

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

  if (error) {
    return (
      <ErrorState
        title="Unable to load the policy comparison"
        detail={error}
        reassurance="Check that the backend is running and try again."
      />
    );
  }
  if (!data) return <LoadingState label="Loading evaluation…" />;

  const chartData = data.policies.map((p) => ({
    name: shortLabel(p.policy_label),
    net: p.net_revenue,
    isWinner: p.policy_id === "ev_optimized",
  }));

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <PageHeader
        title="Policy comparison"
        description={
          <>
            Exact expected net revenue under four policies, computed offline against the synthetic
            simulator's hidden ground truth on the same held-out batch of {data.batch_size} failed
            payments. This is an offline / simulator-based comparison, not a live A/B test, see{" "}
            <code>docs/EVALUATION.md</code>.
          </>
        }
      />

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
                tickFormatter={(v: number) => formatCurrencyCompact(v)}
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
                    fill={entry.isWinner ? "var(--color-status-success)" : "var(--color-chart-neutral)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card padded={false}>
        <Table>
          <thead>
            <TableHeaderRow>
              <Th>Policy</Th>
              <Th align="right">Revenue recovered</Th>
              <Th align="right">Intervention cost</Th>
              <Th align="right">Net revenue</Th>
              <Th align="right">Net / ₹ spent</Th>
            </TableHeaderRow>
          </thead>
          <tbody>
            {data.policies.map((p) => (
              <PolicyRow key={p.policy_id} policy={p} />
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function PolicyRow({ policy }: { policy: PolicyResult }) {
  const isWinner = policy.policy_id === "ev_optimized";
  return (
    <Tr style={{ background: isWinner ? "var(--color-status-success-bg)" : undefined }}>
      <Td>
        <div className="flex items-center gap-2">
          <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
            {policy.policy_label}
          </span>
          {isWinner && <StatusBadge tone="success">this project</StatusBadge>}
        </div>
      </Td>
      <Td align="right" mono>
        {formatCurrency(policy.total_expected_revenue_recovered)}
      </Td>
      <Td align="right" mono>
        {formatCurrency(policy.total_intervention_cost)}
      </Td>
      <Td align="right" mono className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
        {formatCurrency(policy.net_revenue)}
      </Td>
      <Td align="right" mono>
        {policy.net_revenue_per_rupee.toFixed(2)}x
      </Td>
    </Tr>
  );
}

function shortLabel(label: string): string {
  return label.replace(" (this project)", "");
}
