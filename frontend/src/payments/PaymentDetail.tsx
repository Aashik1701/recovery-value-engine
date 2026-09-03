import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { NegotiationAnalyzeResponse } from "../api/types";
import { SuccessScoreDial } from "../components/SuccessScoreDial";
import { Card } from "../components/Card";
import { Field } from "../components/Field";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";
import { WhyNotPanel } from "../components/WhyNotPanel";
import { FAILURE_REASON_LABELS, INTERVENTION_LABELS, formatCurrency, formatProbabilityRange } from "../lib/format";
import { ConfidenceTag } from "../components/ConfidenceTag";
import { MethodRankingCard, METHOD_LABELS, scoreBand } from "./MethodRankingCard";
import { PaymentTimeline } from "./PaymentTimeline";
import { deriveQualitativeSignals, type SignalLevel } from "./pssConditions";
import { usePaymentFlow, type PaymentFlowPhase } from "./usePaymentFlow";
import { BackLink } from "../components/PageHeader";
import { LoadingState, ErrorState } from "../components/PageState";
import { Button } from "../components/Button";
import { CheckIcon, WarningIcon, CrossIcon } from "../components/icons";

const SIGNAL_TONE: Record<SignalLevel, StatusTone> = { healthy: "success", elevated: "pending", degraded: "danger" };
const SIGNAL_ICON: Record<SignalLevel, React.ComponentType<{ size?: number }>> = {
  healthy: CheckIcon,
  elevated: WarningIcon,
  degraded: CrossIcon,
};

function SignalIcon({ level }: { level: SignalLevel }) {
  const Icon = SIGNAL_ICON[level];
  return <Icon size={13} />;
}

function statusLabelForPhase(phase: PaymentFlowPhase): { label: string; tone: StatusTone } {
  switch (phase) {
    case "loading_payment":
    case "scoring":
      return { label: "Loading", tone: "neutral" };
    case "ready":
      return { label: "Awaiting payment", tone: "pending" };
    case "processing":
      return { label: "Processing", tone: "pending" };
    case "success":
      return { label: "Paid", tone: "success" };
    case "failed":
      return { label: "Payment failed", tone: "danger" };
    case "recovery_evaluating":
      return { label: "Evaluating recovery", tone: "pending" };
    case "recovery_decided":
      return { label: "Recovery decided", tone: "pending" };
    case "recovered":
      return { label: "Recovery action created", tone: "success" };
    case "recovery_failed":
      return { label: "Recovery action failed", tone: "danger" };
    case "error":
      return { label: "Error", tone: "danger" };
  }
}

export function PaymentDetail() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { state, selectMethod, attemptPayment } = usePaymentFlow(paymentId);
  const { phase, payment, score, selectedMethod, decision, errorMessage, timeline } = state;

  const status = statusLabelForPhase(phase);
  const selectedScore = score?.methods.find((m) => m.method === selectedMethod) ?? null;
  const hasFailed = phase === "failed" || phase === "recovery_evaluating" || phase === "recovery_decided" || phase === "recovered" || phase === "recovery_failed";

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <BackLink to="/payments" label="Payments" />

      {phase === "loading_payment" && <LoadingState label="Loading payment…" />}
      {phase === "error" && (
        <ErrorState
          title="Unable to connect to Payment Intelligence"
          detail={errorMessage ?? "unknown error"}
          reassurance="Check that the backend is running and try again."
        />
      )}

      {payment && (
        <>
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p style={{ fontFamily: "var(--font-family-data)", fontSize: 13, color: "var(--color-text-muted)" }}>
                  PAYMENT #{payment.payment_id}
                </p>
                <p
                  className="mt-1 font-semibold"
                  style={{ fontFamily: "var(--font-family-data)", fontSize: 30, color: "var(--color-text-primary)" }}
                >
                  {formatCurrency(payment.amount)}
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  Customer: <span style={{ fontFamily: "var(--font-family-data)" }}>{payment.customer_id}</span>
                </p>
              </div>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </div>
          </Card>

          {phase === "scoring" && <LoadingState label="Calculating payment reliability…" />}

          {score && (phase === "ready" || phase === "processing") && (
            <ReadyView
              score={score.methods}
              selectedMethod={selectedMethod}
              onSelect={selectMethod}
              signals={deriveQualitativeSignals(score, selectedMethod ?? score.recommended_method)}
              onPay={() => selectedMethod && attemptPayment(payment, score, selectedMethod)}
              busy={phase === "processing"}
              amount={payment.amount}
            />
          )}

          {phase === "success" && selectedScore && (
            <SuccessView amount={payment.amount} paymentId={payment.payment_id} method={selectedMethod!} score={selectedScore.score} />
          )}

          {hasFailed && selectedScore && (
            <FailedView
              amount={payment.amount}
              reason={payment.failure_reason}
              score={selectedScore.score}
              evaluating={phase === "recovery_evaluating"}
            />
          )}

          {decision && (phase === "recovery_decided" || phase === "recovered" || phase === "recovery_failed") && (
            <RecoveryView decision={decision} phase={phase} />
          )}

          <Card>
            <PaymentTimeline events={timeline} />
          </Card>
        </>
      )}
    </div>
  );
}

function ReadyView({
  score,
  selectedMethod,
  onSelect,
  signals,
  onPay,
  busy,
  amount,
}: {
  score: NonNullable<ReturnType<typeof usePaymentFlow>["state"]["score"]>["methods"];
  selectedMethod: string | null;
  onSelect: (m: import("../api/types").PaymentMethod) => void;
  signals: ReturnType<typeof deriveQualitativeSignals>;
  onPay: () => void;
  busy: boolean;
  amount: number;
}) {
  const selected = score.find((m) => m.method === selectedMethod);
  const band = selected ? scoreBand(selected.score) : null;

  return (
    <>
      <Card>
        <div className="flex flex-col items-center gap-2 py-2">
          <SuccessScoreDial
            score={selected?.score ?? 0}
            degraded={(selected?.score ?? 100) < 65}
            accentColor="var(--color-primary)"
            dangerColor="var(--color-status-danger)"
            trackColor="var(--color-border)"
            centerValueColor="var(--color-text-primary)"
            centerMaxColor="var(--color-text-muted)"
          />
          <p style={{ fontFamily: "var(--font-family-data)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
            Payment success score
          </p>
          {band && <StatusBadge tone={band.tone}>{band.label}</StatusBadge>}
          <p className="text-xs text-center max-w-xs" style={{ color: "var(--color-text-muted)" }}>
            Based on current test/simulated conditions for this payment — not a live gateway signal.
          </p>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--color-text-primary)" }}>Payment methods</p>
        <div className="flex flex-col gap-2">
          {score.map((m) => (
            <MethodRankingCard key={m.method} method={m} selected={m.method === selectedMethod} onSelect={() => onSelect(m.method)} disabled={busy} />
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--color-text-muted)" }}>
          The recommendation is based on current simulated/test conditions, not a production gateway-routing decision.
        </p>
      </Card>

      <Card>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--color-text-primary)" }}>Why this score?</p>
        <div className="flex flex-col gap-2">
          {signals.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span className="flex items-center" style={{ color: "var(--color-text-secondary)" }}>
                <span
                  className="inline-flex items-center"
                  style={{ color: `var(--color-status-${s.level === "healthy" ? "success" : s.level === "elevated" ? "pending" : "danger"})`, marginRight: 8 }}
                >
                  <SignalIcon level={s.level} />
                </span>
                {s.label}
              </span>
              <StatusBadge tone={SIGNAL_TONE[s.level]}>{s.detail}</StatusBadge>
            </div>
          ))}
        </div>
      </Card>

      <Button variant="primary" fullWidth busy={busy} disabled={!selectedMethod} onClick={onPay} style={{ padding: "12px 20px", fontSize: 15 }}>
        {busy ? "Processing payment…" : `Pay ${formatCurrency(amount)}`}
      </Button>
      <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
        If the payment still fails, Recovery Value Engine takes over — deciding whether to recover it, and how.
      </p>
    </>
  );
}

function SuccessView({ amount, paymentId, method, score }: { amount: number; paymentId: string; method: string; score: number }) {
  return (
    <Card>
      <div className="flex flex-col items-center text-center gap-2 py-4">
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "var(--color-status-success-bg)",
            color: "var(--color-status-success-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden="true"
        >
          <CheckIcon size={22} />
        </div>
        <p className="font-semibold" style={{ fontSize: 17, color: "var(--color-text-primary)" }}>Test payment successful</p>
        <p style={{ fontFamily: "var(--font-family-data)", fontSize: 24, color: "var(--color-text-primary)" }}>{formatCurrency(amount)}</p>

        <dl className="grid grid-cols-3 gap-4 mt-4 text-left w-full max-w-sm">
          <Field label="Payment ID"><span style={{ fontFamily: "var(--font-family-data)", fontSize: 12.5 }}>{paymentId}</span></Field>
          <Field label="Method">{METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method}</Field>
          <Field label="Score before payment">{score}/100</Field>
        </dl>
      </div>
    </Card>
  );
}

function FailedView({ amount, reason, score, evaluating }: { amount: number; reason: string; score: number; evaluating: boolean }) {
  return (
    <>
      <Card>
        <p className="font-semibold" style={{ fontSize: 15, color: "var(--color-status-danger-text)" }}>
          Payment could not be completed
        </p>
        <p style={{ fontFamily: "var(--font-family-data)", fontSize: 20, color: "var(--color-text-primary)", marginTop: 6 }}>
          {formatCurrency(amount)}
        </p>
        <dl className="grid grid-cols-2 gap-4 mt-3 text-sm">
          <Field label="Reason">{FAILURE_REASON_LABELS[reason as keyof typeof FAILURE_REASON_LABELS] ?? reason}</Field>
          <Field label="Payment success score">{score}/100</Field>
        </dl>
      </Card>

      <Card>
        <p className="font-semibold" style={{ fontSize: 15, color: "var(--color-text-primary)" }}>Recovery Value Engine</p>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
          {evaluating
            ? "Payment failure detected. Evaluating the highest-value recovery path…"
            : "Payment failure detected."}
        </p>
      </Card>
    </>
  );
}

function RecoveryView({ decision, phase }: { decision: import("../api/types").Decision; phase: PaymentFlowPhase }) {
  const chosen = decision.evaluations.find((e) => e.status === "chosen");

  return (
    <>
      <Card>
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-family-data)" }}>
          Recovery opportunity
        </p>
        <p style={{ fontFamily: "var(--font-family-data)", fontSize: 22, color: "var(--color-text-primary)", marginTop: 4 }}>
          {formatCurrency(decision.amount)}
        </p>

        {decision.risk_policy && (
          <div
            className="mt-4 pt-4 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs uppercase" style={{ color: "var(--color-status-danger-text)" }}>
                ⛔ Recovery suppressed — risk policy
              </p>
              <StatusBadge tone="danger">{decision.risk_policy}</StatusBadge>
            </div>
            <p className="text-sm mt-2" style={{ color: "var(--color-status-danger-text)" }}>
              {decision.explanation}
            </p>
          </div>
        )}

        {decision.escalated && !decision.risk_policy && (
          <div
            className="mt-4 pt-4 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase" style={{ color: "var(--color-status-pending-text)" }}>
                Escalated to a human
              </p>
              <ConfidenceTag tier={decision.confidence_tier} />
            </div>
            <p className="text-sm mt-2" style={{ color: "var(--color-status-pending-text)" }}>
              {decision.explanation}
            </p>
          </div>
        )}

        {chosen && !decision.escalated && !decision.risk_policy && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-xs uppercase" style={{ color: "var(--color-text-muted)" }}>Recommended</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="font-semibold" style={{ fontSize: 16, color: "var(--color-text-primary)" }}>
                {INTERVENTION_LABELS[chosen.intervention_id]}
              </p>
              <StatusBadge tone="success">winner by EV</StatusBadge>
              <ConfidenceTag tier={chosen.confidence_tier} />
            </div>
            <div className="flex gap-6 mt-2">
              <Field label="Expected value">{formatCurrency(chosen.expected_value)}</Field>
              <Field label="P(recovery)">
                {formatProbabilityRange(chosen.probability_recovery, chosen.probability_spread)}
              </Field>
            </div>
            <p className="text-sm mt-3" style={{ color: "var(--color-text-secondary)" }}>{decision.explanation}</p>
          </div>
        )}

        {phase === "recovered" && decision.payment_link_url && (
          <div className="mt-4 pt-4 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--color-border)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                Recovery action created
              </p>
              <a href={decision.payment_link_url} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-family-data)", fontSize: 13 }}>
                Open Razorpay Test Payment Link
              </a>
            </div>
            <StatusBadge tone="success">TEST MODE</StatusBadge>
          </div>
        )}

        {phase === "recovery_failed" && decision.payment_link_error && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--color-status-danger-text)" }}>
              Recovery action could not be executed
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>Reason: {decision.payment_link_error}</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              The decision remains recorded and auditable below. No link was fabricated, and no retry has been fired automatically.
            </p>
          </div>
        )}
      </Card>

      <WhyNotPanel evaluations={decision.evaluations} />
      <NegotiationPreview paymentId={decision.payment_id} />
    </>
  );
}

function NegotiationPreview({ paymentId }: { paymentId: string }) {
  const [preview, setPreview] = useState<NegotiationAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .recoveryNegotiationAnalyze({ payment_id: paymentId })
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Recovery negotiation is temporarily unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  if (error) return null; // preview is a nice-to-have; a failed fetch here must not block the rest of the page
  if (!preview) return null;

  const optimumCandidate = preview.candidates.find((c) => c.incentive === preview.optimum_candidate);

  return (
    <Card>
      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-family-data)" }}>
        Recovery negotiation
      </p>
      <div className="flex items-center justify-between mt-2">
        <div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Minimum effective intervention</p>
          <p className="font-semibold" style={{ fontSize: 18, fontFamily: "var(--font-family-data)", color: "var(--color-status-success-text)" }}>
            {preview.minimum_effective_intervention !== null ? formatCurrency(preview.minimum_effective_intervention) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Expected net value</p>
          <p className="font-semibold" style={{ fontSize: 18, fontFamily: "var(--font-family-data)", color: "var(--color-text-primary)" }}>
            {optimumCandidate?.expected_net_value !== undefined && optimumCandidate.expected_net_value !== null
              ? formatCurrency(optimumCandidate.expected_net_value)
              : "—"}
          </p>
        </div>
      </div>
      <Link
        to={`/recovery-negotiation?paymentId=${encodeURIComponent(paymentId)}`}
        className="text-xs mt-3 inline-block"
        style={{ color: "var(--color-primary)" }}
      >
        Open Recovery Negotiation →
      </Link>
    </Card>
  );
}
