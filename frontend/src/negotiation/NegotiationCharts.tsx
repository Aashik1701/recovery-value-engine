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
import type { NegotiationCandidate } from "../api/types";
import { formatCurrency, formatCurrencyCompact } from "../lib/format";
import { Card } from "../components/Card";

/**
 * The centerpiece visualization: recovery probability keeps climbing with
 * incentive, but net value peaks then declines -- the product's central
 * insight, made visually obvious by marking the three outcomes distinctly
 * on both charts rather than merging them into one highlighted point.
 */
export function NegotiationCharts({
  candidates,
  maxRecoveryProbabilityCandidate,
  optimumCandidate,
  minimumEffectiveIntervention,
}: {
  candidates: NegotiationCandidate[];
  maxRecoveryProbabilityCandidate: number | null;
  optimumCandidate: number | null;
  minimumEffectiveIntervention: number | null;
}) {
  const eligible = candidates.filter((c) => c.eligible);
  const probData = eligible.map((c) => ({ x: c.incentive, y: (c.recovery_probability ?? 0) * 100 }));
  const valueData = eligible.map((c) => ({ x: c.incentive, y: c.expected_net_value ?? 0 }));

  const probAt = (incentive: number | null) => (incentive === null ? null : (probData.find((d) => d.x === incentive)?.y ?? null));
  const valueAt = (incentive: number | null) => (incentive === null ? null : (valueData.find((d) => d.x === incentive)?.y ?? null));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Recovery probability
          </h3>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Higher recovery probability does not always mean higher economic value
          </span>
        </div>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={probData} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="x"
                type="number"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                tickFormatter={(v: number) => formatCurrencyCompact(v)}
              />
              <YAxis
                dataKey="y"
                type="number"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { x: number; y: number };
                  return (
                    <div className="text-xs rounded px-2.5 py-2" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                      <p style={{ color: "var(--color-text-primary)" }}>Incentive: ₹{d.x}</p>
                      <p style={{ color: "var(--color-text-secondary)" }}>P(recovery): {d.y.toFixed(1)}%</p>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="y" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} />
              {probAt(maxRecoveryProbabilityCandidate) !== null && (
                <ReferenceDot
                  x={maxRecoveryProbabilityCandidate!}
                  y={probAt(maxRecoveryProbabilityCandidate)!}
                  r={6}
                  fill="var(--color-status-pending)"
                  stroke="none"
                  label={{ value: "MAX RECOVERY", position: "top", fontSize: 10, fill: "var(--color-status-pending-text)" }}
                />
              )}
              {probAt(minimumEffectiveIntervention) !== null && (
                <ReferenceDot
                  x={minimumEffectiveIntervention!}
                  y={probAt(minimumEffectiveIntervention)!}
                  r={6}
                  fill="var(--color-status-success)"
                  stroke="none"
                  label={{ value: "MINIMUM EFFECTIVE", position: "bottom", fontSize: 10, fill: "var(--color-status-success-text)" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Expected net value
          </h3>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            The economically optimal point, not the most recovery
          </span>
        </div>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={valueData} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="x"
                type="number"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                tickFormatter={(v: number) => formatCurrencyCompact(v)}
              />
              <YAxis
                dataKey="y"
                type="number"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                tickFormatter={(v: number) => formatCurrencyCompact(v)}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { x: number; y: number };
                  return (
                    <div className="text-xs rounded px-2.5 py-2" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                      <p style={{ color: "var(--color-text-primary)" }}>Incentive: ₹{d.x}</p>
                      <p style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>Net value: {formatCurrency(d.y)}</p>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="y" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} />
              {valueAt(optimumCandidate) !== null && (
                <ReferenceDot
                  x={optimumCandidate!}
                  y={valueAt(optimumCandidate)!}
                  r={6}
                  fill="var(--color-primary)"
                  stroke="none"
                  label={{ value: "MAX NET VALUE", position: "top", fontSize: 10, fill: "var(--color-primary)" }}
                />
              )}
              {valueAt(minimumEffectiveIntervention) !== null && (
                <ReferenceDot
                  x={minimumEffectiveIntervention!}
                  y={valueAt(minimumEffectiveIntervention)!}
                  r={6}
                  fill="var(--color-status-success)"
                  stroke="none"
                  label={{ value: "MINIMUM EFFECTIVE", position: "bottom", fontSize: 10, fill: "var(--color-status-success-text)" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
