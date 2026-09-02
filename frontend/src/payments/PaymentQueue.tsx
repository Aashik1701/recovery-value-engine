import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision, PSSScoreResponse } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { formatCurrency } from "../lib/format";
import { METHOD_LABELS, scoreBand } from "./MethodRankingCard";
import { conditionsForPayment } from "./pssConditions";
import { PageHeader } from "../components/PageHeader";
import { LoadingState, ErrorState, TableStateRow } from "../components/PageState";
import { StatTile, StatTileGrid } from "../components/StatTile";
import { Table, TableHeaderRow, Td, Th, Tr } from "../components/Table";

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
      <ErrorState
        title="Unable to connect to Payment Intelligence"
        detail={error}
        reassurance="Check that the backend is running and try again."
      />
    );
  }

  if (!rows) {
    return <LoadingState label="Loading payments…" />;
  }

  const recommendedScores = rows.filter((r) => r.score).map((r) => r.score!.methods.find((m) => m.recommended)!.score);
  const avgScore = recommendedScores.length ? Math.round(recommendedScores.reduce((a, b) => a + b, 0) / recommendedScores.length) : null;
  const atRisk = rows.filter((r) => r.score && r.score.methods.find((m) => m.recommended)!.score < 65);
  const revenueAtRisk = atRisk.reduce((sum, r) => sum + r.payment.amount, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Payment Intelligence"
        description="Understand payment reliability before failure, and recover value when it slips through."
      />

      <Card>
        <StatTileGrid cols={4}>
          <StatTile label="Payments monitored" value={String(rows.length)} />
          <StatTile label="Average success score" value={avgScore !== null ? `${avgScore}/100` : "—"} />
          <StatTile label="At-risk payments" value={String(atRisk.length)} tone={atRisk.length > 0 ? "danger" : undefined} />
          <StatTile label="Revenue at risk" value={formatCurrency(revenueAtRisk)} tone={revenueAtRisk > 0 ? "danger" : undefined} />
        </StatTileGrid>
      </Card>

      <Card padded={false}>
        <Table style={{ width: "100%" }}>
          <thead>
            <TableHeaderRow>
              <Th>Payment</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Method</Th>
              <Th align="right">Score</Th>
              <Th>Status</Th>
            </TableHeaderRow>
          </thead>
          <tbody>
            {rows.map(({ payment, score, scoreError }) => {
              const recommended = score?.methods.find((m) => m.recommended);
              const band = recommended ? scoreBand(recommended.score) : null;
              return (
                <Tr key={payment.payment_id} onClick={() => navigate(`/payments/${payment.payment_id}`)}>
                  <Td mono>{payment.payment_id}</Td>
                  <Td mono style={{ color: "var(--color-text-muted)" }}>
                    {payment.customer_id}
                  </Td>
                  <Td align="right" mono>
                    {formatCurrency(payment.amount)}
                  </Td>
                  <Td>{recommended ? METHOD_LABELS[recommended.method] : "—"}</Td>
                  <Td align="right" mono>
                    {recommended ? `${recommended.score}/100` : "—"}
                  </Td>
                  <Td>
                    {band ? (
                      <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
                    ) : (
                      <span title={scoreError ?? undefined}>
                        <StatusBadge tone="danger">Unavailable</StatusBadge>
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
            {rows.length === 0 && <TableStateRow colSpan={6}>You're all caught up — no payments in the current batch.</TableStateRow>}
          </tbody>
        </Table>
      </Card>

      <p className="text-xs max-w-2xl" style={{ color: "var(--color-text-muted)" }}>
        Payments are simulated/test records from the RVE synthetic batch. Scores are computed by the Payment Success
        Score model against per-payment synthetic conditions, an offline estimate, not a live gateway signal. See{" "}
        <code>docs/PAYMENT_PAGE.md</code>.
      </p>
    </div>
  );
}
