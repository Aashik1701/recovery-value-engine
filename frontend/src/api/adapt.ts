/**
 * Adapts the backend's actual JSON shapes (Pydantic models in
 * backend/app/models.py) to this app's `Decision`/`InterventionEvaluation`
 * types in ./types.ts. The two were built independently against the written
 * API contract in CLAUDE.md Section 13 and landed on different field names
 * (`all_evs` vs `evaluations`, `probability_of_recovery` vs
 * `probability_recovery`, `eligible`/`blocked_reason` vs
 * `status`/`rejection_reason`), this module is the single place that
 * reconciles the drift rather than changing either side's natural shape.
 */
import type {
  CalibrationPoint,
  Decision,
  DecisionsListResponse,
  EvaluateResponse,
  FailureReason,
  InterventionEvaluation,
  InterventionId,
  MetricsResponse,
  PolicyResult,
  SimulateResponse,
  TransactionType,
} from "./types";

interface RawInterventionEV {
  intervention_id: string;
  probability_of_recovery: number;
  unit_cost: number;
  expected_value: number;
  eligible: boolean;
  blocked_reason: string | null;
}

export interface RawAuditRecord {
  decision_id: string;
  payment_id: string;
  customer_id: string;
  amount: number;
  failure_reason: string;
  transaction_type: string;
  decided_at: string;
  all_evs: RawInterventionEV[];
  chosen_intervention: string;
  explanation: string;
  payment_link_url: string | null;
  payment_link_error: string | null;
}

export interface RawDecideResponse {
  chosen_intervention: string;
  explanation: string;
  audit_record: RawAuditRecord;
}

export interface RawDecisionsResponse {
  total: number;
  page: number;
  page_size: number;
  decisions: RawAuditRecord[];
}

function adaptEvaluation(
  raw: RawInterventionEV,
  amount: number,
  chosenId: string,
  chosenEv: number,
): InterventionEvaluation {
  const isChosen = raw.intervention_id === chosenId;
  const status: InterventionEvaluation["status"] = isChosen
    ? "chosen"
    : !raw.eligible
      ? "blocked_by_guardrail"
      : "rejected";

  let rejectionReason: string | undefined;
  if (status === "blocked_by_guardrail") {
    rejectionReason = raw.blocked_reason ?? "Blocked by a guardrail.";
  } else if (status === "rejected") {
    rejectionReason = `Rejected: lower expected value (₹${raw.expected_value.toFixed(
      2,
    )} vs ₹${chosenEv.toFixed(2)} for the chosen action)`;
  }

  return {
    intervention_id: raw.intervention_id as InterventionId,
    probability_recovery: raw.probability_of_recovery,
    amount,
    unit_cost: raw.unit_cost,
    expected_value: raw.expected_value,
    status,
    rejection_reason: rejectionReason,
  };
}

export function adaptAuditRecord(raw: RawAuditRecord): Decision {
  const chosenRaw = raw.all_evs.find((e) => e.intervention_id === raw.chosen_intervention);
  const chosenEv = chosenRaw?.expected_value ?? 0;

  return {
    decision_id: raw.decision_id,
    payment_id: raw.payment_id,
    customer_id: raw.customer_id,
    amount: raw.amount,
    failure_reason: raw.failure_reason as FailureReason,
    transaction_type: raw.transaction_type as TransactionType,
    chosen_intervention: raw.chosen_intervention as InterventionId,
    decided_at: raw.decided_at,
    evaluations: raw.all_evs
      .map((e) => adaptEvaluation(e, raw.amount, raw.chosen_intervention, chosenEv))
      .sort((a, b) => b.expected_value - a.expected_value),
    explanation: raw.explanation,
    payment_link_url: raw.payment_link_url,
    payment_link_error: raw.payment_link_error,
  };
}

export function adaptDecisionsResponse(raw: RawDecisionsResponse): DecisionsListResponse {
  return {
    items: raw.decisions.map(adaptAuditRecord),
    total: raw.total,
    page: raw.page,
    page_size: raw.page_size,
  };
}

// ---------------------------------------------------------------------------
// /evaluate
// ---------------------------------------------------------------------------

interface RawPolicyResult {
  policy_name: string;
  n_payments: number;
  total_expected_revenue: number;
  total_cost: number;
  net_revenue: number;
  net_revenue_per_rupee: number;
}

export interface RawEvaluateResponse {
  n_payments_evaluated: number;
  policies: RawPolicyResult[];
  note: string;
}

const POLICY_LABELS: Record<string, string> = {
  always_do_nothing: "Always do nothing",
  always_retry_now: "Always retry now",
  rule_based_heuristic: "Rule-based heuristic",
  ev_optimized: "EV-optimized policy (this project)",
};

function adaptPolicyResult(raw: RawPolicyResult): PolicyResult {
  return {
    policy_id: raw.policy_name as PolicyResult["policy_id"],
    policy_label: POLICY_LABELS[raw.policy_name] ?? raw.policy_name,
    total_expected_revenue_recovered: raw.total_expected_revenue,
    total_intervention_cost: raw.total_cost,
    net_revenue: raw.net_revenue,
    net_revenue_per_rupee: raw.net_revenue_per_rupee,
  };
}

export function adaptEvaluateResponse(raw: RawEvaluateResponse): EvaluateResponse {
  return {
    evaluated_at: new Date().toISOString(),
    batch_size: raw.n_payments_evaluated,
    policies: raw.policies.map(adaptPolicyResult),
  };
}

// ---------------------------------------------------------------------------
// /metrics
// ---------------------------------------------------------------------------

interface RawCalibrationBin {
  mean_predicted_probability: number;
  fraction_of_positives: number;
  n_samples: number;
}

export interface RawMetricsResponse {
  auc: number;
  n_train: number;
  n_test: number;
  calibration_bins: RawCalibrationBin[];
}

export function adaptMetricsResponse(raw: RawMetricsResponse): MetricsResponse {
  return {
    auc: raw.auc,
    // The backend doesn't compute a Brier score; report -1 as an explicit
    // "not available" sentinel rather than fabricating a number. The UI
    // hides the tile when it sees this.
    brier_score: -1,
    trained_at: new Date().toISOString(),
    n_training_rows: raw.n_train + raw.n_test,
    calibration_curve: raw.calibration_bins.map(
      (b): CalibrationPoint => ({
        // Backend bins are quantile-based (equal sample count, not equal
        // probability width), so it only reports each bin's mean predicted
        // probability, not real edges. Collapsing start/end to that same
        // point is more honest than fabricating a range.
        bucket_start: b.mean_predicted_probability,
        bucket_end: b.mean_predicted_probability,
        predicted_mean: b.mean_predicted_probability,
        observed_mean: b.fraction_of_positives,
        n: b.n_samples,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// /simulate
// ---------------------------------------------------------------------------

export interface RawSimulateResponse {
  seed: number;
  n_customers: number;
  n_training_logs: number;
  n_batch_payments: number;
  message: string;
}

export function adaptSimulateResponse(raw: RawSimulateResponse): SimulateResponse {
  return {
    batch_id: `seed-${raw.seed}`,
    n_customers: raw.n_customers,
    n_failed_payments: raw.n_batch_payments,
    generated_at: new Date().toISOString(),
  };
}
