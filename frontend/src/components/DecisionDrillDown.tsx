import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Decision } from "../api/types";
import {
  FAILURE_REASON_LABELS,
  INTERVENTION_LABELS,
  formatCurrency,
  formatDateTime,
  formatPercent,
} from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";
import { WhyNotPanel } from "./WhyNotPanel";
import { BackLink, PageHeader } from "./PageHeader";
import { LoadingState, ErrorState } from "./PageState";

export function DecisionDrillDown() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  // POST /decide/{payment_id} is intentionally NOT idempotent -- each real
  // call appends a fresh audit record and, when sms_link is chosen, fires a
  // real Razorpay payment-link call (see backend/app/main.py). React 18/19
  // StrictMode double-invokes effects in development (mount, cleanup,
  // mount) to surface missing-cleanup bugs; without a guard, that would
  // fire this non-idempotent call twice per page visit, silently doubling
  // audit entries and live Razorpay calls.
  //
  // The guard is the ref itself, checked both before firing AND when the
  // response lands -- not a per-invocation `cancelled` boolean. An earlier
  // version used `cancelled`, but StrictMode calls the first invocation's
  // cleanup (setting `cancelled = true`) before the guarded second
  // invocation runs, which would've discarded the one real response
  // forever and left the page stuck on "Loading decision...". Comparing
  // `firedForRef.current` to `paymentId` at resolution time avoids that:
  // it still ignores a stale response after `paymentId` has since changed,
  // without needing a separate flag that StrictMode's synthetic remount
  // can prematurely trip.
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    if (firedForRef.current === paymentId) return;
    firedForRef.current = paymentId;
    setDecision(null);
    setError(null);
    api
      .decide(paymentId)
      .then((res) => {
        if (firedForRef.current === paymentId) setDecision(res.decision);
      })
      .catch((err: unknown) => {
        if (firedForRef.current === paymentId) {
          firedForRef.current = null; // allow a retry (e.g. paymentId revisited after a failure)
          setError(err instanceof Error ? err.message : "Failed to load decision");
        }
      });
  }, [paymentId]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load this decision"
        detail={error}
        reassurance="Check that the backend is running and try again."
      />
    );
  }
  if (!decision) return <LoadingState label="Loading decision…" />;

  const chosen = decision.evaluations.find((e) => e.status === "chosen");

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <PageHeader
        backTo={<BackLink to="/dashboard" label="Back to decision queue" />}
        title={<span className="font-data">{decision.payment_id}</span>}
        description={formatDateTime(decision.decided_at)}
      />

      <Card>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Field label="Customer">
            <span className="font-data">{decision.customer_id}</span>
          </Field>
          <Field label="Amount">
            <span className="font-data">{formatCurrency(decision.amount)}</span>
          </Field>
          <Field label="Failure reason">{FAILURE_REASON_LABELS[decision.failure_reason]}</Field>
          <Field label="Transaction type">
            {decision.transaction_type === "one_time" ? "One-time" : "Subscription"}
          </Field>
        </dl>
      </Card>

      {chosen && (
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Chosen intervention
              </p>
              <div className="flex items-center gap-2 mt-1">
                <h2 className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {INTERVENTION_LABELS[chosen.intervention_id]}
                </h2>
                <StatusBadge tone="success">winner by EV</StatusBadge>
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <Stat label="P(recovery)" value={formatPercent(chosen.probability_recovery)} />
              <Stat label="Unit cost" value={formatCurrency(chosen.unit_cost)} />
              <Stat label="Expected value" value={formatCurrency(chosen.expected_value)} emphasize />
            </div>
          </div>
          <p
            className="text-sm mt-4 pt-4 border-t"
            style={{ color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }}
          >
            {decision.explanation}
          </p>
          {decision.payment_link_url && (
            <div
              className="mt-4 pt-4 border-t flex items-center justify-between gap-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Live Razorpay test-mode payment link
                </p>
                <a href={decision.payment_link_url} target="_blank" rel="noreferrer" className="font-data text-sm">
                  {decision.payment_link_url}
                </a>
              </div>
              <StatusBadge tone="success">real API call</StatusBadge>
            </div>
          )}
          {decision.payment_link_error && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Razorpay payment link unavailable: {decision.payment_link_error}
              </p>
            </div>
          )}
        </Card>
      )}

      <WhyNotPanel evaluations={decision.evaluations} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className="mt-0.5" style={{ color: "var(--color-text-primary)" }}>
        {children}
      </dd>
    </div>
  );
}

function Stat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p
        className="font-data"
        style={{
          color: emphasize ? "var(--color-status-success-text)" : "var(--color-text-primary)",
          fontWeight: emphasize ? 600 : 400,
        }}
      >
        {value}
      </p>
    </div>
  );
}
