import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision } from "../api/types";
import { FAILURE_REASON_LABELS, formatCurrency } from "../lib/format";
import { SearchIcon } from "./icons";

/**
 * Top-bar search: real, not decorative. Fetches the existing /decisions
 * list once (same data PaymentSelector already uses) and filters it
 * client-side by payment_id/customer_id -- jumps straight to a payment's
 * detail page. No fake results, no fabricated categories.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout (and this search box within it) persists across route changes --
  // without this, navigating away via the sidebar instead of a search
  // result left a stale query and an open results dropdown behind.
  useEffect(() => {
    setQuery("");
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    api
      .listDecisions(1, 200)
      .then((res) => setDecisions(res.items))
      .catch(() => setDecisions([]));
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  // A payment can legitimately have more than one audit record (the initial
  // batch decision, plus a fresh one if it was later retried live) -- dedupe
  // by payment_id so search never shows the same payment twice or keys two
  // result rows identically.
  const matches = q
    ? Array.from(
        new Map(
          decisions
            .filter((d) => d.payment_id.toLowerCase().includes(q) || d.customer_id.toLowerCase().includes(q))
            .map((d) => [d.payment_id, d]),
        ).values(),
      ).slice(0, 8)
    : [];

  function goTo(paymentId: string) {
    navigate(`/payments/${paymentId}`);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative hidden md:block" style={{ width: 280 }}>
      <div
        className="flex items-center gap-2 rounded border px-2.5"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)", height: 32 }}
      >
        <span style={{ color: "var(--color-text-muted)" }}>
          <SearchIcon size={14} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search payments, customers…"
          className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none"
          style={{ color: "var(--color-text-primary)" }}
        />
      </div>

      {open && q && (
        <div
          className="absolute left-0 right-0 mt-1 rounded border overflow-hidden z-10"
          style={{ background: "var(--card-bg)", borderColor: "var(--card-border)", boxShadow: "var(--shadow-md)" }}
        >
          {matches.length === 0 ? (
            <p className="text-xs px-3 py-3" style={{ color: "var(--color-text-muted)" }}>
              No payments match "{query}".
            </p>
          ) : (
            matches.map((d) => (
              <button
                key={d.payment_id}
                type="button"
                onClick={() => goTo(d.payment_id)}
                className="w-full text-left px-3 py-2 text-sm transition-colors block"
                style={{ color: "var(--color-text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <span style={{ fontFamily: "var(--font-family-data)" }}>{d.payment_id}</span>
                <span className="ml-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {formatCurrency(d.amount)} · {FAILURE_REASON_LABELS[d.failure_reason]}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
