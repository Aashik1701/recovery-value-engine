import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Decision, InterventionId, PSSScoreResponse, PaymentMethod } from "../api/types";
import { INTERVENTION_LABELS } from "../lib/format";
import { conditionsForPayment } from "./pssConditions";

/**
 * A single, non-overlapping state per CLAUDE.md's "no impossible UI
 * states" requirement (see docs/PAYMENT_PAGE.md) -- the detail page
 * renders off `phase` alone, so "success" and "failed" (or "processing"
 * and "recovery_decided") can never both be true at once the way two
 * independent booleans could drift into.
 */
export type PaymentFlowPhase =
  | "loading_payment"
  | "scoring"
  | "ready"
  | "processing"
  | "success"
  | "failed"
  | "recovery_evaluating"
  | "recovery_decided" // a non-sms_link intervention was chosen; nothing external executed
  | "recovered" // sms_link chosen AND a real Razorpay test-mode link was created
  | "recovery_failed" // sms_link chosen but the Razorpay call failed
  | "error";

export interface TimelineEvent {
  id: string;
  at: string; // ISO timestamp, captured client-side at the moment this event was observed
  label: string;
  detail?: string;
}

export interface PaymentFlowState {
  phase: PaymentFlowPhase;
  payment: Decision | null;
  score: PSSScoreResponse | null;
  selectedMethod: PaymentMethod | null;
  failureReason: string | null;
  decision: Decision | null; // the RVE AuditRecord, once /decide has returned
  errorMessage: string | null;
  timeline: TimelineEvent[];
}

const INITIAL_STATE: PaymentFlowState = {
  phase: "loading_payment",
  payment: null,
  score: null,
  selectedMethod: null,
  failureReason: null,
  decision: null,
  errorMessage: null,
  timeline: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

let eventCounter = 0;
function makeEvent(label: string, detail?: string): TimelineEvent {
  eventCounter += 1;
  return { id: `evt_${eventCounter}`, at: nowIso(), label, detail };
}

export function usePaymentFlow(paymentId: string | undefined) {
  const [state, setState] = useState<PaymentFlowState>(INITIAL_STATE);

  // Guards against a stale response from a previous paymentId (or a
  // superseded /pss/score call) landing after a newer one and clobbering
  // fresher state -- the same principle as DecisionDrillDown.tsx's fix,
  // applied here to two idempotent GET/POST calls rather than one
  // non-idempotent one. Idempotent calls don't need the StrictMode
  // double-invoke guard DecisionDrillDown needed (see docs/PAYMENT_PAGE.md);
  // this ref exists purely for response-ordering safety.
  const loadSeq = useRef(0);

  // Prevents a genuine rapid double-click on "Pay" (or "Retry") from firing
  // /decide twice. Not a StrictMode concern -- attemptPayment only ever
  // runs from a real click event, which StrictMode never replays -- but a
  // real double-click is still possible and this project has already found
  // one duplicate-execution bug the hard way, so this is deliberate, not
  // an oversight.
  const actionInFlight = useRef(false);

  const pushEvent = useCallback((label: string, detail?: string) => {
    setState((s) => ({ ...s, timeline: [...s.timeline, makeEvent(label, detail)] }));
  }, []);

  // ---- load the payment + score it, whenever paymentId changes ----------
  useEffect(() => {
    if (!paymentId) return;
    const seq = ++loadSeq.current;
    setState({ ...INITIAL_STATE, phase: "loading_payment" });

    api
      .listDecisions(1, 500)
      .then((res) => {
        if (seq !== loadSeq.current) return;
        const payment = res.items.find((d) => d.payment_id === paymentId);
        if (!payment) {
          setState((s) => ({ ...s, phase: "error", errorMessage: `Unknown payment_id: ${paymentId}` }));
          return;
        }
        setState((s) => ({
          ...s,
          phase: "scoring",
          payment,
          timeline: [...s.timeline, makeEvent("Payment loaded", `${payment.payment_id} · ₹${payment.amount.toFixed(2)}`)],
        }));

        return api
          .pssScore(conditionsForPayment(payment.payment_id, payment.amount, payment.transaction_type))
          .then((score) => {
            if (seq !== loadSeq.current) return;
            setState((s) => ({
              ...s,
              phase: "ready",
              score,
              selectedMethod: score.recommended_method,
              timeline: [
                ...s.timeline,
                makeEvent("Payment Success Score calculated", `${score.methods.find((m) => m.recommended)?.score ?? "?"}/100`),
              ],
            }));
          });
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return;
        setState((s) => ({
          ...s,
          phase: "error",
          errorMessage: err instanceof Error ? err.message : "Unable to connect to Payment Intelligence.",
        }));
      });
  }, [paymentId]);

  const selectMethod = useCallback(
    (method: PaymentMethod) => {
      setState((s) => {
        if (s.phase !== "ready" || s.selectedMethod === method) return s;
        return {
          ...s,
          selectedMethod: method,
          timeline: [...s.timeline, makeEvent("Selected payment method", method.toUpperCase())],
        };
      });
    },
    [],
  );

  /**
   * Takes the payment/score/method as arguments rather than reading them
   * back out of `state` inside the callback: the caller (PaymentDetail,
   * which only renders the "Pay" button once phase === "ready" and all
   * three are already known non-null) has them narrowed for free from its
   * own render-time destructuring. Threading them through a setState
   * updater closure to "read current state" works at runtime but defeats
   * TypeScript's control-flow narrowing across the closure boundary --
   * passing typed arguments sidesteps that class of problem entirely
   * rather than fighting it.
   */
  const attemptPayment = useCallback(async (payment: Decision, score: PSSScoreResponse, selectedMethod: PaymentMethod) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;

    setState((s) => {
      if (s.phase !== "ready") return s;
      return { ...s, phase: "processing", timeline: [...s.timeline, makeEvent("Payment attempt started", selectedMethod.toUpperCase())] };
    });

    // Short, real UI transition (not a simulated backend wait -- there is
    // no backend call to await here, see docs/PAYMENT_PAGE.md's honesty
    // section) so "Processing payment..." is perceptible rather than a
    // one-frame flash.
    await new Promise((r) => setTimeout(r, 550));

    const methodScore = score.methods.find((m) => m.method === selectedMethod);
    const succeeded = Math.random() < (methodScore?.success_probability ?? 0);

    if (succeeded) {
      setState((s) => ({ ...s, phase: "success", timeline: [...s.timeline, makeEvent("Test payment successful", selectedMethod.toUpperCase())] }));
      actionInFlight.current = false;
      return;
    }

    const reason = payment.failure_reason;
    setState((s) => ({ ...s, phase: "failed", failureReason: reason, timeline: [...s.timeline, makeEvent("Payment failed", reason)] }));

    setState((s) => ({ ...s, phase: "recovery_evaluating", timeline: [...s.timeline, makeEvent("Recovery Value Engine evaluating")] }));
    try {
      const res = await api.decide(payment.payment_id);
      const decision = res.decision;
      const interventionLabel = INTERVENTION_LABELS[decision.chosen_intervention as InterventionId] ?? decision.chosen_intervention;
      const chosenEv = decision.evaluations.find((e) => e.status === "chosen")?.expected_value;

      setState((s) => {
        const events = [
          ...s.timeline,
          makeEvent(`RVE evaluated ${decision.evaluations.length} interventions`),
          makeEvent(`${interventionLabel} selected`, chosenEv !== undefined ? `Expected value ₹${chosenEv.toFixed(2)}` : undefined),
        ];

        if (decision.chosen_intervention === "sms_link" && decision.payment_link_url) {
          events.push(makeEvent("Razorpay test-mode payment link created"));
          return { ...s, phase: "recovered", decision, timeline: events };
        }
        if (decision.chosen_intervention === "sms_link" && decision.payment_link_error) {
          events.push(makeEvent("Razorpay test-mode link creation failed", decision.payment_link_error ?? undefined));
          return { ...s, phase: "recovery_failed", decision, timeline: events };
        }
        return { ...s, phase: "recovery_decided", decision, timeline: events };
      });
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : "Recovery evaluation failed.",
      }));
    } finally {
      actionInFlight.current = false;
    }
  }, []);

  return { state, selectMethod, attemptPayment, pushEvent };
}
