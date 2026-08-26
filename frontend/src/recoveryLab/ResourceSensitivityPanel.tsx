import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RecoveryLabSensitivityResponse } from "../api/types";
import { Card } from "../components/Card";
import { formatCurrency } from "../lib/format";
import { SENSITIVITY_DIMENSION_LABELS, formatLevel } from "./labFormat";

const DIMENSIONS: RecoveryLabSensitivityResponse["dimension"][] = [
  "voice_capacity",
  "discount_budget",
  "max_contacts_per_customer",
];

export function ResourceSensitivityPanel({
  dimension,
  onDimensionChange,
  sensitivity,
  loading,
}: {
  dimension: string;
  onDimensionChange: (d: string) => void;
  sensitivity: RecoveryLabSensitivityResponse | null;
  loading: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Find the efficient operating point
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Net value as this resource scales, holding everything else in the last simulation fixed.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {DIMENSIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDimensionChange(d)}
              className="text-xs px-2 py-1 rounded border"
              style={{
                background: d === dimension ? "var(--color-primary-subtle)" : "var(--color-bg-surface)",
                color: d === dimension ? "var(--color-primary)" : "var(--color-text-secondary)",
                borderColor: d === dimension ? "var(--color-primary-border)" : "var(--color-border)",
              }}
            >
              {SENSITIVITY_DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-muted)" }}>
          Running sensitivity sweep…
        </p>
      )}

      {!loading && sensitivity && (
        <>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={sensitivity.points} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="level"
                  tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                  tickFormatter={(v: number) => formatLevel(sensitivity.dimension, v)}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(v) => `${SENSITIVITY_DIMENSION_LABELS[sensitivity.dimension]}: ${formatLevel(sensitivity.dimension, Number(v))}`}
                  contentStyle={{
                    background: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "var(--radius-md)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="net_value_created"
                  name="Net value"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <ReferenceDot
                  x={sensitivity.optimal_level}
                  y={sensitivity.optimal_net_value}
                  r={6}
                  fill="var(--color-status-success)"
                  stroke="var(--card-bg)"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-sm mt-2 pt-2 border-t" style={{ color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }}>
            {sensitivity.insight}
          </p>
        </>
      )}
    </Card>
  );
}
