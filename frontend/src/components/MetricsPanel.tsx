import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { MetricsResponse } from "../api/types";
import { formatDateTime } from "../lib/format";
import { Card } from "./Card";

export function MetricsPanel() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .metrics()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load metrics");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <Card>Could not load model metrics: {error}</Card>;
  if (!data) return <Card>Loading metrics…</Card>;

  const chartData = data.calibration_curve.map((c) => ({
    bucket: `${Math.round(c.bucket_start * 100)}–${Math.round(c.bucket_end * 100)}%`,
    predicted: c.predicted_mean,
    observed: c.observed_mean,
  }));

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Recovery-probability model quality
        </h1>
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Standard supervised-learning metrics on a held-out slice of{" "}
          <code>training_logs</code>. Unlike the policy comparison, this is a normal ML claim with
          no offline-vs-live caveat.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            AUC
          </p>
          <p className="text-2xl font-semibold font-data mt-1" style={{ color: "var(--color-text-primary)" }}>
            {data.auc.toFixed(3)}
          </p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Brier score
          </p>
          <p className="text-2xl font-semibold font-data mt-1" style={{ color: "var(--color-text-primary)" }}>
            {data.brier_score.toFixed(3)}
          </p>
        </Card>
        <Card>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Training rows
          </p>
          <p className="text-2xl font-semibold font-data mt-1" style={{ color: "var(--color-text-primary)" }}>
            {data.n_training_rows.toLocaleString("en-IN")}
          </p>
        </Card>
      </div>

      <Card>
        <p className="text-sm font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
          Calibration curve
        </p>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                domain={[0, 1]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="predicted"
                name="Predicted mean"
                stroke="var(--slate-400)"
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="observed"
                name="Observed mean"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Last trained {formatDateTime(data.trained_at)}
      </p>
    </div>
  );
}
