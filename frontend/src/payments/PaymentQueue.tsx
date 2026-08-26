import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision, PSSScoreResponse } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { formatCurrency } from "../lib/format";
import { METHOD_LABELS, scoreBand } from "./MethodRankingCard";
import { conditionsForPayment } from "./pssConditions";

const QUEUE_SIZE = 30; // bounded on purpose -- see docs/PAYMENT_PAGE.md's performance note

interface Row {
  payment: Decision;
  score: PSSScoreResponse | null;
  scoreError: string | null;
}

export function PaymentQueue() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    setRows(null);
    setError(null);

    api
      .listDecisions(1, QUEUE_SIZE)
      .then(async (res) => {
        if (seq !== loadSeq.current) return;
        const seen = new Set<string>();
        const unique = res.items.filter((d) => (seen.has(d.payment_id) ? false : (seen.add(d.payment_id), true)));

        const scored = await Promise.all(
          unique.map(async (payment): Promise<Row> => {
            try {
              const score = await api.pssScore(conditionsForPayment(payment.payment_id, payment.amount, payment.transaction_type));
              return { payment, score, scoreError: null };
            } catch (err: unknown) {
              return { payment, score: null, scoreError: err instanceof Error ? err.message : "Score unavailable" };
            }
          }),
        );
        if (seq !== loadSeq.current) return;
        setRows(scored);
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return;
        setError(err instanceof Error ? err.message : "Unable to connect to Payment Intelligence.");
      });
  }, []);

  if (error) {
    return (
      <Card>
        <p style={{ color: "var(--color-status-danger-text)" }}>Unable to connect to Payment Intelligence: {error}</p>
      </Card>
    );
  }

  if (!rows) {
    return <Card>Loading payments…</Card>;
  }

  const recommendedScores = rows.filter((r) => r.score).map((r) => r.score!.methods.find((m) => m.recommended)!.score);
  const avgScore = recommendedScores.length ? Math.round(recommendedScores.reduce((a, b) => a + b, 0) / recommendedScores.length) : null;
  const atRisk = rows.filter((r) => r.score && r.score.methods.find((m) => m.recommended)!.score < 65);
  const revenueAtRisk = atRisk.reduce((sum, r) => sum + r.payment.amount, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Payment Intelligence
        </h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: "var(--color-text-secondary)" }}>
          Understand payment reliability before failure — and recover value when it slips through.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <SummaryTile label="Payments monitored" value={String(rows.length)} />
        <SummaryTile label="Average success score" value={avgScore !== null ? `${avgScore}/100` : "—"} />
        <SummaryTile label="At-risk payments" value={String(atRisk.length)} tone={atRisk.length > 0 ? "danger" : undefined} />
        <SummaryTile label="Revenue at risk" value={formatCurrency(revenueAtRisk)} tone={revenueAtRisk > 0 ? "danger" : undefined} />
      </div>

      <Card padded={false}>
        <table style={{ width: "100%", fontSize: "var(--table-font-size)" }}>
          <thead>
            <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
              <Th>Payment</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Method</Th>
              <Th align="right">Score</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ payment, score, scoreError }) => {
              const recommended = score?.methods.find((m) => m.recommended);
              const band = recommended ? scoreBand(recommended.score) : null;
              return (
                <tr
                  key={payment.payment_id}
                  onClick={() => navigate(`/payments/${payment.payment_id}`)}
                  className="cursor-pointer border-t"
                  style={{ height: "var(--table-row-height)", borderColor: "var(--table-border-color)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--table-row-hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <Td mono>{payment.payment_id}</Td>
                  <Td mono muted>{payment.customer_id}</Td>
                  <Td align="right" mono>{formatCurrency(payment.amount)}</Td>
                  <Td>{recommended ? METHOD_LABELS[recommended.method] : "—"}</Td>
                  <Td align="right" mono>{recommended ? `${recommended.score}/100` : "—"}</Td>
                  <Td>
                    {band ? (
                      <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
                    ) : (
                      <span style={{ color: "var(--color-status-danger-text)", fontSize: 12.5 }}>{scoreError ?? "Unavailable"}</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="text-xs max-w-2xl" style={{ color: "var(--color-text-muted)" }}>
        Payments are simulated/test records from the RVE synthetic batch. Scores are computed by the Payment Success
        Score model against per-payment synthetic conditions — an offline estimate, not a live gateway signal. See{" "}
        <code>docs/PAYMENT_PAGE.md</code>.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <Card>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</p>
      <p
        className="mt-1 font-semibold"
        style={{
          fontFamily: "var(--font-family-data)",
          fontSize: 22,
          color: tone === "danger" ? "var(--color-status-danger-text)" : "var(--color-text-primary)",
        }}
      >
        {value}
      </p>
    </Card>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({
  children,
  align = "left",
  mono = false,
  muted = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 ${align === "right" ? "text-right" : "text-left"}`}
      style={{
        fontFamily: mono ? "var(--font-family-data)" : undefined,
        color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
      }}
    >
      {children}
    </td>
  );
}
