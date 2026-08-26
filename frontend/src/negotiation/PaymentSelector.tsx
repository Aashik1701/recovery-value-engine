import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Decision } from "../api/types";
import { Card } from "../components/Card";
import { FAILURE_REASON_LABELS, formatCurrency } from "../lib/format";

/** Reuses the existing /decisions list (no new list endpoint) as a
 * client-side searchable payment selector. */
export function PaymentSelector({
  selectedPaymentId,
  onSelect,
}: {
  selectedPaymentId: string | null;
  onSelect: (paymentId: string) => void;
}) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .listDecisions(1, 100)
      .then((res) => {
        if (!cancelled) setDecisions(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load payments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = query.trim()
    ? decisions.filter(
        (d) =>
          d.payment_id.toLowerCase().includes(query.toLowerCase()) ||
          d.customer_id.toLowerCase().includes(query.toLowerCase()),
      )
    : decisions;

  return (
    <Card>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>
        Select a payment
      </p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by payment ID or customer ID"
        className="w-full rounded border px-2.5 py-1.5 text-sm mb-2"
        style={{ background: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
      />
      {loading && <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading payments…</p>}
      {error && <p className="text-xs" style={{ color: "var(--color-status-danger-text)" }}>{error}</p>}
      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {filtered.slice(0, 30).map((d) => (
          <button
            key={d.payment_id}
            type="button"
            onClick={() => onSelect(d.payment_id)}
            className="text-left rounded px-2.5 py-1.5 text-sm transition-colors"
            style={{
              background: d.payment_id === selectedPaymentId ? "var(--color-primary-subtle)" : "transparent",
              color: d.payment_id === selectedPaymentId ? "var(--color-primary)" : "var(--color-text-primary)",
            }}
          >
            <span style={{ fontFamily: "var(--font-family-data)" }}>{d.payment_id}</span>
            <span className="ml-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              {formatCurrency(d.amount)} · {FAILURE_REASON_LABELS[d.failure_reason]}
            </span>
          </button>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No payments match this search.</p>
        )}
      </div>
    </Card>
  );
}
