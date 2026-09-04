import type { TimingPreviewResponse, TimingPreviewScenarioId } from "../api/types";

/**
 * Fixtures for GET /decide/demo/timing-preview/{scenario} -- Optimal
 * Recovery Timing PREVIEW only (see docs/ROADMAP.md). Values below are a
 * literal copy of the real backend's computed response for each scenario
 * (app/timing_preview.py), not independently re-derived -- so mock mode
 * can never silently drift from what the live heuristic actually produces.
 */
const FIXTURES: Record<TimingPreviewScenarioId, TimingPreviewResponse> = {
  insufficient_funds_wait: {
    scenario: "insufficient_funds_wait",
    payment_id: "pay_demo_timing_wait",
    customer_id: "cust_demo_timing_wait",
    amount: 8200.0,
    failure_reason: "insufficient_funds",
    transaction_type: "one_time",
    retry_count_so_far: 0,
    action_intervention_id: "retry_later",
    action_unit_cost: 1.0,
    description:
      'insufficient_funds: recovery probability plausibly rises with time (salary/cash-flow timing) -- the "why tomorrow, not now" case.',
    candidates: [
      { bucket_id: "now", bucket_label: "Now", probability_of_recovery: 0.12, expected_value: 983.0, is_recommended: false },
      { bucket_id: "plus_30min", bucket_label: "+30 min", probability_of_recovery: 0.14, expected_value: 1147.0, is_recommended: false },
      { bucket_id: "plus_2h", bucket_label: "+2h", probability_of_recovery: 0.18, expected_value: 1475.0, is_recommended: false },
      { bucket_id: "plus_6h", bucket_label: "+6h", probability_of_recovery: 0.25, expected_value: 2049.0, is_recommended: false },
      { bucket_id: "tomorrow_am", bucket_label: "Tomorrow AM", probability_of_recovery: 0.45, expected_value: 3689.0, is_recommended: false },
      { bucket_id: "tomorrow_pm", bucket_label: "Tomorrow PM", probability_of_recovery: 0.55, expected_value: 4509.0, is_recommended: true },
    ],
    recommended_bucket_id: "tomorrow_pm",
    recommended_bucket_label: "Tomorrow PM",
    timing_lever_relevant: true,
    timing_not_the_lever_note: null,
    is_heuristic_preview: true,
    note: "Illustrative timing curves, not fitted from data — see ROADMAP.md",
  },
  bank_timeout_now: {
    scenario: "bank_timeout_now",
    payment_id: "pay_demo_timing_now",
    customer_id: "cust_demo_timing_now",
    amount: 3400.0,
    failure_reason: "bank_timeout",
    transaction_type: "one_time",
    retry_count_so_far: 0,
    action_intervention_id: "retry_now",
    action_unit_cost: 2.0,
    description:
      "bank_timeout: a transient technical failure -- waiting doesn't help and intent fades, so the heuristic recommends acting now, not waiting.",
    candidates: [
      { bucket_id: "now", bucket_label: "Now", probability_of_recovery: 0.70, expected_value: 2378.0, is_recommended: true },
      { bucket_id: "plus_30min", bucket_label: "+30 min", probability_of_recovery: 0.65, expected_value: 2208.0, is_recommended: false },
      { bucket_id: "plus_2h", bucket_label: "+2h", probability_of_recovery: 0.55, expected_value: 1868.0, is_recommended: false },
      { bucket_id: "plus_6h", bucket_label: "+6h", probability_of_recovery: 0.45, expected_value: 1528.0, is_recommended: false },
      { bucket_id: "tomorrow_am", bucket_label: "Tomorrow AM", probability_of_recovery: 0.35, expected_value: 1188.0, is_recommended: false },
      { bucket_id: "tomorrow_pm", bucket_label: "Tomorrow PM", probability_of_recovery: 0.30, expected_value: 1018.0, is_recommended: false },
    ],
    recommended_bucket_id: "now",
    recommended_bucket_label: "Now",
    timing_lever_relevant: true,
    timing_not_the_lever_note: null,
    is_heuristic_preview: true,
    note: "Illustrative timing curves, not fitted from data — see ROADMAP.md",
  },
  card_expired_flat: {
    scenario: "card_expired_flat",
    payment_id: "pay_demo_timing_flat",
    customer_id: "cust_demo_timing_flat",
    amount: 5600.0,
    failure_reason: "card_expired",
    transaction_type: "subscription",
    retry_count_so_far: 1,
    action_intervention_id: "sms_link",
    action_unit_cost: 3.0,
    description:
      "card_expired: timing isn't the relevant lever at all -- the real answer is switching action (a payment link / new method), not waiting.",
    candidates: [
      { bucket_id: "now", bucket_label: "Now", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: true },
      { bucket_id: "plus_30min", bucket_label: "+30 min", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: false },
      { bucket_id: "plus_2h", bucket_label: "+2h", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: false },
      { bucket_id: "plus_6h", bucket_label: "+6h", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: false },
      { bucket_id: "tomorrow_am", bucket_label: "Tomorrow AM", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: false },
      { bucket_id: "tomorrow_pm", bucket_label: "Tomorrow PM", probability_of_recovery: 0.02, expected_value: 109.0, is_recommended: false },
    ],
    recommended_bucket_id: "now",
    recommended_bucket_label: "Now",
    timing_lever_relevant: false,
    timing_not_the_lever_note:
      "timing has negligible effect for this failure reason — the decision that matters here is which action, not when.",
    is_heuristic_preview: true,
    note: "Illustrative timing curves, not fitted from data — see ROADMAP.md",
  },
};

export function mockTimingPreview(scenario: TimingPreviewScenarioId): TimingPreviewResponse {
  return FIXTURES[scenario];
}

export function timingPreviewScenarioIds(): TimingPreviewScenarioId[] {
  return Object.keys(FIXTURES) as TimingPreviewScenarioId[];
}
