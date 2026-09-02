import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ForensicPaymentRecord, RevenueOutcome, RootCauseDetail } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/Button";
import { ArrowLeftIcon, ArrowRightIcon } from "../components/icons";
import { LoadingState, ErrorState, TableStateRow } from "../components/PageState";
import { Table, TableHeaderRow, Td, Th, Tr } from "../components/Table";
import { FAILURE_REASON_LABELS, INTERVENTION_LABELS, formatCurrency } from "../lib/format";
import { OUTCOME_LABELS, OUTCOME_TONE, formatDelay } from "./autopsyFormat";

const PAGE_SIZE = 15;

/**
 * Server-side paginated/filterable forensic ledger -- never ships the whole
 * batch to the browser (this project's "prefer server-side aggregation, use
 * pagination" requirement). Rows link to the EXISTING /payments/:paymentId
 * route -- no second payment-detail system is built here.
 */
export function ForensicPaymentTable({ causes }: { causes: RootCauseDetail[] }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [cause, setCause] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [items, setItems] = useState<ForensicPaymentRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [cause, status, debouncedSearch]);

  useEffect(() => {
    const mySeq = ++seq.current;
    api
      .revenueAutopsyPayments({ page, page_size: PAGE_SIZE, cause: cause || undefined, status: status || undefined, search: debouncedSearch || undefined })
      .then((res) => {
        if (mySeq !== seq.current) return;
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mySeq !== seq.current) return;
        setError(err instanceof Error ? err.message : "Unable to load forensic payment records.");
      });
  }, [page, cause, status, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card padded={false}>
      <div className="px-4 pt-3.5 pb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Payment-level forensics
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            {total.toLocaleString("en-IN")} payments match the current filters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payment or customer ID"
            aria-label="Search payment or customer ID"
            className="text-sm rounded border px-2.5 py-1.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)", color: "var(--color-text-primary)", minWidth: 220 }}
          />
          <select
            value={cause}
            onChange={(e) => setCause(e.target.value)}
            aria-label="Filter by primary cause"
            className="text-sm rounded border px-2 py-1.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}
          >
            <option value="">All causes</option>
            {causes.map((c) => (
              <option key={c.cause_key} value={c.cause_key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by outcome"
            className="text-sm rounded border px-2 py-1.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}
          >
            <option value="">All outcomes</option>
            {(Object.keys(OUTCOME_LABELS) as RevenueOutcome[]).map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="px-4 pb-4">
          <ErrorState title="Unable to load forensic records" detail={error} reassurance="Check that the backend is running and try again." />
        </div>
      )}
      {!error && !items && (
        <div className="px-4 pb-4">
          <LoadingState label="Loading forensic records…" />
        </div>
      )}

      {!error && items && (
        <div className="overflow-x-auto">
          <Table style={{ minWidth: 920 }}>
            <thead>
              <TableHeaderRow>
                <Th>Payment</Th>
                <Th align="right">Amount</Th>
                <Th>Failure</Th>
                <Th>Primary cause</Th>
                <Th>Contributing</Th>
                <Th>RVE action</Th>
                <Th>Outcome</Th>
                <Th align="right">Recovery delay</Th>
                <Th align="right">Potentially preventable</Th>
              </TableHeaderRow>
            </thead>
            <tbody>
              {items.map((row) => (
                <Tr key={row.payment_id} onClick={() => navigate(`/payments/${row.payment_id}`)}>
                  <Td mono>{row.payment_id}</Td>
                  <Td align="right" mono>
                    {formatCurrency(row.amount)}
                  </Td>
                  <Td>{FAILURE_REASON_LABELS[row.failure_reason]}</Td>
                  <Td>{row.primary_cause_label}</Td>
                  <Td style={{ color: "var(--color-text-muted)" }}>
                    {row.contributing_causes.length ? row.contributing_causes.map((c) => c.label).join(", ") : "—"}
                  </Td>
                  <Td>{row.chosen_intervention ? INTERVENTION_LABELS[row.chosen_intervention] : "—"}</Td>
                  <Td>
                    <StatusBadge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABELS[row.outcome]}</StatusBadge>
                  </Td>
                  <Td align="right" mono>
                    {formatDelay(row.recovery_decision_delay_hours)}
                  </Td>
                  <Td align="right" mono>
                    {formatCurrency(row.preventable_amount)}
                  </Td>
                </Tr>
              ))}
              {items.length === 0 && <TableStateRow colSpan={9}>No payments match the current filters.</TableStateRow>}
            </tbody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <ArrowLeftIcon size={12} /> Previous
        </Button>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          Next <ArrowRightIcon size={12} />
        </Button>
      </div>
    </Card>
  );
}
