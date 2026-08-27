import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RecoveryDelayAnalysis } from "../api/types";
import { Card } from "../components/Card";
import { formatHours } from "./autopsyFormat";

export function RecoveryDelayPanel({ delay }: { delay: RecoveryDelayAnalysis }) {
  const chartData = delay.buckets.map((b) => ({
    label: b.label,
    rate: Math.round(b.recovery_rate * 1000) / 10,
    n: b.n_payments,
  }));

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Recovery delay analysis
        </h2>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Time to first intervention: {formatHours(delay.mean_time_to_first_intervention_hours)} · Time to recovery:{" "}
          {formatHours(delay.mean_time_to_recovery_hours)}
        </span>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              formatter={(value, _name, item) => [`${value}% recovered (${item.payload.n} payments)`, "Recovery rate"]}
              contentStyle={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: "var(--radius-md)",
                fontSize: 12,
              }}
            />
            <Bar dataKey="rate" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs mt-2 pt-2 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
        {delay.disclaimer}
      </p>
    </Card>
  );
}
