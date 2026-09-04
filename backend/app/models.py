"""Pydantic models and static reference data for the Recovery Value Engine.

Every request/response body that crosses the FastAPI boundary in main.py is
defined here as a Pydantic model -- no raw dicts cross the API boundary.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums (shared vocabulary across the whole system)
# ---------------------------------------------------------------------------


class FailureReason(str, Enum):
    INSUFFICIENT_FUNDS = "insufficient_funds"
    BANK_TIMEOUT = "bank_timeout"
    NETWORK_ERROR = "network_error"
    CARD_EXPIRED = "card_expired"
    FRAUD_BLOCK = "fraud_block"
    OTHER = "other"


class TransactionType(str, Enum):
    ONE_TIME = "one_time"
    SUBSCRIPTION = "subscription"


class PreferredChannel(str, Enum):
    SMS = "sms"
    WHATSAPP = "whatsapp"
    EMAIL = "email"
    VOICE = "voice"
    NONE = "none"


class InterventionId(str, Enum):
    NO_ACTION = "no_action"
    RETRY_NOW = "retry_now"
    RETRY_LATER = "retry_later"
    SMS_LINK = "sms_link"
    WHATSAPP_NUDGE = "whatsapp_nudge"
    EMAIL = "email"
    VOICE_CALL = "voice_call"


# Static reference menu: intervention_id -> unit cost in INR.
# Kept here (rather than in simulator.py) so ev_engine/guardrails/optimizer
# can all import it without pulling in simulator's generation logic.
INTERVENTION_UNIT_COSTS: Dict[str, float] = {
    InterventionId.NO_ACTION.value: 0.0,
    InterventionId.RETRY_NOW.value: 2.0,
    InterventionId.RETRY_LATER.value: 1.0,
    InterventionId.SMS_LINK.value: 3.0,
    InterventionId.WHATSAPP_NUDGE.value: 5.0,
    InterventionId.EMAIL.value: 1.0,
    InterventionId.VOICE_CALL.value: 15.0,
}

ALL_INTERVENTION_IDS: List[str] = list(INTERVENTION_UNIT_COSTS.keys())

# A terminal decision outcome that is NOT an intervention: the model's
# confidence (bootstrap-ensemble disagreement) on the top-ranked action is
# below the escalation threshold, so the decision is handed to a human
# instead of committed autonomously. Deliberately kept out of
# ALL_INTERVENTION_IDS / INTERVENTION_UNIT_COSTS -- it costs nothing, never
# touches Razorpay, and is not a channel. See probability_model.should_escalate.
ESCALATE = "escalate"

# Interventions that do NOT involve contacting the customer. Used by the
# suppression-list guardrail: suppressed customers may still receive these.
NON_CONTACT_INTERVENTIONS = {
    InterventionId.NO_ACTION.value,
    InterventionId.RETRY_NOW.value,
}

VOICE_CALL_AMOUNT_THRESHOLD = 5000.0
CONTACT_FREQUENCY_CAP = 2


# ---------------------------------------------------------------------------
# Domain records
# ---------------------------------------------------------------------------


class Customer(BaseModel):
    customer_id: str
    ltv: float
    past_success_rate: float = Field(ge=0.0, le=1.0)
    preferred_channel: PreferredChannel


class FailedPayment(BaseModel):
    payment_id: str
    customer_id: str
    amount: float = Field(gt=0)
    failure_reason: FailureReason
    transaction_type: TransactionType
    failed_at: datetime
    retry_count_so_far: int = Field(ge=0)


# ---------------------------------------------------------------------------
# /simulate
# ---------------------------------------------------------------------------


class SimulateRequest(BaseModel):
    n_customers: int = Field(default=2000, gt=0)
    n_training_logs: int = Field(default=30000, gt=0)
    n_batch_payments: int = Field(default=500, gt=0)
    seed: int = Field(default=42)


class SimulateResponse(BaseModel):
    seed: int
    n_customers: int
    n_training_logs: int
    n_batch_payments: int
    message: str


# ---------------------------------------------------------------------------
# /health -- readiness probe for the demo (see docs/PITCH_SCRIPT.md "Startup").
# Unguarded (never 503s): the frontend polls this while the backend is still
# training its model on boot so the dashboard shows a clean "starting up"
# state instead of a wall of failed requests.
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    # "ok" once the RVE batch + probability model + PSS model are all built;
    # "initializing" during the ~30-40s cold-start model fit (or a runtime
    # /simulate re-train). The frontend gates data-page rendering on `ready`.
    status: str
    ready: bool
    rve_ready: bool
    pss_ready: bool
    ensemble_ready: bool
    seed: int
    n_batch_payments: int
    n_decisions_logged: int
    # The deterministic canonical demo payment for the judge walkthrough
    # (docs/PITCH_SCRIPT.md). Stable for a given seed; surfaced here so the
    # frontend never has to guess it from array order. None until ready.
    canonical_payment_id: Optional[str] = None


# ---------------------------------------------------------------------------
# /decide/{payment_id}
# ---------------------------------------------------------------------------


class InterventionEV(BaseModel):
    """One line of the audit trail: what an intervention would have cost/earned."""

    intervention_id: str
    probability_of_recovery: float
    # Bootstrap-ensemble std dev on probability_of_recovery for this
    # (context, intervention) -- how much the ensemble members disagree.
    # Shown in the UI as "P% +/- spread". Defaults to 0.0 so pre-ensemble
    # callers / fixtures stay valid.
    probability_spread: float = 0.0
    confidence_tier: str = "high"
    unit_cost: float
    expected_value: float
    eligible: bool
    blocked_reason: Optional[str] = None


class AuditRecord(BaseModel):
    decision_id: str
    payment_id: str
    customer_id: str
    amount: float
    failure_reason: FailureReason
    transaction_type: TransactionType
    # Context the dashboard's "recovery opportunity" queue needs to render a
    # "customer history" column (how many times has this payment already
    # been retried) without a second lookup -- the value was already known
    # at decide-time (it's a feature the model itself trains on), just never
    # previously surfaced on the audit record.
    retry_count_so_far: int
    decided_at: datetime
    all_evs: List[InterventionEV]
    # "escalate" here (rather than an intervention_id) means the confidence
    # gate fired -- see `escalated`.
    chosen_intervention: str
    # Confidence signal for the top-ranked action: the ensemble spread on it,
    # its tier, and whether that tripped the escalation threshold. When
    # escalated, `chosen_intervention == "escalate"` and no channel was run.
    chosen_probability_spread: float = 0.0
    confidence_tier: str = "high"
    escalated: bool = False
    # Set to the canonical policy id (e.g. "fraud_block_recovery_suppression")
    # when the hard risk policy suppressed recovery for this payment -- see
    # guardrails.recovery_suppression_policy. None for every normally-decided
    # payment. When set: chosen_intervention is always "no_action", escalated
    # is always False, and no channel / retry / incentive / escalation /
    # Razorpay path ran. Every non-no_action row in all_evs carries the
    # suppression reason in its blocked_reason.
    risk_policy: Optional[str] = None
    explanation: str
    # Only populated when chosen_intervention == "sms_link" -- the one
    # intervention that hits Razorpay's real test-mode API. Both null
    # for every other intervention.
    payment_link_url: Optional[str] = None
    payment_link_error: Optional[str] = None


class DecideResponse(BaseModel):
    chosen_intervention: str
    explanation: str
    audit_record: AuditRecord


# ---------------------------------------------------------------------------
# /decisions
# ---------------------------------------------------------------------------


class DecisionsResponse(BaseModel):
    total: int
    page: int
    page_size: int
    decisions: List[AuditRecord]


# ---------------------------------------------------------------------------
# /evaluate
# ---------------------------------------------------------------------------


class PolicyResult(BaseModel):
    policy_name: str
    n_payments: int
    total_expected_revenue: float
    total_cost: float
    net_revenue: float
    net_revenue_per_rupee: float


class EvaluateResponse(BaseModel):
    n_payments_evaluated: int
    policies: List[PolicyResult]
    note: str = (
        "Offline / simulator-based evaluation using hidden synthetic ground "
        "truth. This is NOT a live A/B test -- see docs/EVALUATION.md."
    )


# ---------------------------------------------------------------------------
# /metrics
# ---------------------------------------------------------------------------


class CalibrationBin(BaseModel):
    mean_predicted_probability: float
    fraction_of_positives: float
    n_samples: int


class MetricsResponse(BaseModel):
    auc: float
    n_train: int
    n_test: int
    calibration_bins: List[CalibrationBin]
    # Bootstrap-ensemble confidence layer (see probability_model.py). The
    # ensemble is not used as the point estimate -- only its per-prediction
    # spread (std dev) is, as an uncertainty signal. Thresholds are the
    # 33rd / 67th / 95th percentiles of the held-out spread distribution;
    # spread >= spread_p95 routes a live decision to escalation.
    n_ensemble: int = 0
    spread_p33: Optional[float] = None
    spread_p67: Optional[float] = None
    spread_p95: Optional[float] = None


# ---------------------------------------------------------------------------
# /pss/score -- Payment Success Score (v2, see docs/PAYMENT_PAGE.md)
# ---------------------------------------------------------------------------


class PSSConditions(BaseModel):
    """Live conditions to score payment methods under. All fields optional
    with healthy defaults, so the frontend's what-if sliders can send just
    the ones a visitor has touched."""

    gateway_latency_ms: float = Field(default=100.0, ge=0)
    gateway_error_rate: float = Field(default=0.01, ge=0.0, le=1.0)
    traffic_load_index: float = Field(default=1.0, ge=0)
    merchant_uptime_pct: float = Field(default=99.8, ge=0.0, le=100.0)
    amount: float = Field(default=1999.0, gt=0)
    transaction_type: TransactionType = TransactionType.ONE_TIME


class PSSMethodScore(BaseModel):
    method: str
    success_probability: float
    score: int = Field(ge=0, le=100)
    recommended: bool


class PSSScoreResponse(BaseModel):
    conditions: PSSConditions
    methods: List[PSSMethodScore]  # sorted descending by success_probability
    recommended_method: str
    healthy_baseline_score: int
    delta_from_healthy: int
    note: str = (
        "Offline / simulator-based estimate from a synthetic model -- not a "
        "live signal from any real payment gateway. See docs/PAYMENT_PAGE.md "
        "for the full honesty boundary."
    )


# ---------------------------------------------------------------------------
# Recovery Lab -- "Revenue Recovery Digital Twin" (recovery_lab.py)
#
# A merchant-strategy simulation layer that sits ABOVE the RVE per-payment
# decision pipeline: instead of deciding one failed payment, it simulates
# what would happen if a chosen recovery POLICY were applied to the whole
# synthetic failed-payment population, under configurable resource
# constraints. Entirely offline/synthetic; never calls Razorpay, never sends
# a real message, never mutates real payment or audit state. See
# docs/RECOVERY_DIGITAL_TWIN.md.
# ---------------------------------------------------------------------------


class RecoveryLabPolicyId(str, Enum):
    NO_INTERVENTION = "no_intervention"
    ALWAYS_RETRY = "always_retry"
    AGGRESSIVE_RECOVERY = "aggressive_recovery"
    RVE_ADAPTIVE = "rve_adaptive"


class ContactIntensity(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


RECOVERY_LAB_NOTE = (
    "Offline / synthetic simulation using the existing synthetic failed-payment "
    "population and the trained RVE recovery-probability model. This is a "
    "policy-testing environment, not a production forecast -- no real payment, "
    "customer, or recovery action is executed. See docs/RECOVERY_DIGITAL_TWIN.md."
)


class RecoveryLabSimulateRequest(BaseModel):
    policy: RecoveryLabPolicyId = RecoveryLabPolicyId.RVE_ADAPTIVE
    contact_intensity: ContactIntensity = ContactIntensity.MODERATE
    discount_budget: float = Field(default=50_000.0, ge=0)
    voice_capacity: int = Field(default=1000, ge=0)
    max_contacts_per_customer: int = Field(default=2, ge=1, le=3)
    recovery_window_hours: int = Field(default=168, gt=0)
    n_simulation_runs: int = Field(default=1000, ge=0, le=20_000)
    seed: int = Field(default=42)


class RecoveryLabPolicyMetrics(BaseModel):
    policy_id: str
    policy_label: str
    n_payments_in_scope: int
    total_at_risk: float
    natural_recovery: float
    gross_recovery: float
    incremental_recovery: float
    intervention_cost: float
    net_value_created: float
    recovery_rate: float
    incremental_recovery_rate: float
    number_intervened: int
    number_contacted: int
    number_blocked_by_guardrail: int
    number_blocked_by_capacity: int
    number_blocked: int
    # Payments where rve_adaptive's confidence gate fired (ensemble spread on
    # the top-ranked action >= escalation threshold). Accounted as no_action
    # (the autonomous system took no action). Always 0 for the other three
    # policies, which never consult the model. The allocation / allocation_spend
    # dicts carry a matching "escalate" key.
    number_escalated: int = 0
    average_cost_per_recovery: float
    # Per-intervention breakdown of the final assignment across the in-scope
    # batch -- keyed by every id in ALL_INTERVENTION_IDS ("no_action"
    # included), counts sum to n_payments_in_scope. Powers the Recovery Lab
    # interactive panel's allocation chart. A pure read of the same final
    # assignment the headline metrics are computed from -- adding it changes
    # no decision, guardrail, or accounting logic. ``allocation_spend`` is
    # count * unit_cost per id and sums (to rounding) to intervention_cost.
    allocation: Dict[str, int] = {}
    allocation_spend: Dict[str, float] = {}
    # Monte Carlo simulation uncertainty around net_value_created -- a
    # sampling-variance range from re-drawing binary recovery outcomes, NOT
    # a statistical confidence interval on a real-world estimate. Absent
    # (None) when n_simulation_runs == 0 (e.g. the sensitivity sweep, which
    # skips Monte Carlo per level for performance).
    net_value_low: Optional[float] = None
    net_value_high: Optional[float] = None


class RecoveryLabSimulateResponse(BaseModel):
    seed: int
    n_simulation_runs: int
    primary_policy_id: str
    n_payments_in_scope: int
    total_at_risk: float
    policies: List[RecoveryLabPolicyMetrics]
    insight: str
    example_payment_id: Optional[str] = None
    note: str = RECOVERY_LAB_NOTE


class RecoveryLabExposureResponse(BaseModel):
    total_at_risk: float
    n_failed_payments: int
    median_payment_value: float
    suggested_policy_label: str = "RVE Adaptive"
    note: str = RECOVERY_LAB_NOTE


class RecoveryLabSensitivityRequest(BaseModel):
    policy: RecoveryLabPolicyId = RecoveryLabPolicyId.RVE_ADAPTIVE
    dimension: str = Field(description="One of: voice_capacity, discount_budget, max_contacts_per_customer")
    contact_intensity: ContactIntensity = ContactIntensity.MODERATE
    discount_budget: float = Field(default=50_000.0, ge=0)
    voice_capacity: int = Field(default=1000, ge=0)
    max_contacts_per_customer: int = Field(default=2, ge=1, le=3)
    recovery_window_hours: int = Field(default=168, gt=0)
    seed: int = Field(default=42)
    levels: Optional[List[float]] = None


class RecoveryLabSensitivityPoint(BaseModel):
    level: float
    incremental_recovery: float
    intervention_cost: float
    net_value_created: float


class RecoveryLabSensitivityResponse(BaseModel):
    dimension: str
    policy_id: str
    points: List[RecoveryLabSensitivityPoint]
    optimal_level: float
    optimal_net_value: float
    insight: str
    note: str = RECOVERY_LAB_NOTE


# ---------------------------------------------------------------------------
# Revenue Recovery Autopsy (revenue_autopsy.py)
#
# A forensic / root-cause layer built ON TOP of the existing synthetic batch
# and the existing RVE audit log. RVE answers "what should we do with this
# failed payment"; Autopsy answers "why did this revenue leak, how much was
# preventable/recoverable, and what should the merchant fix first." It never
# calls Razorpay, never appends to the RVE audit log, and never re-scores the
# probability model -- every probability/EV it shows is read straight out of
# the AuditRecord already produced by /decide. Like evaluator.py and
# recovery_lab.py, it is one of the few modules allowed to read the hidden
# `_simulator_truth` table (needed to derive a REALIZED recovery outcome per
# payment -- see revenue_autopsy.py's module docstring for why that field
# doesn't already exist and how it's generated). Entirely offline/synthetic;
# see docs/REVENUE_RECOVERY_AUTOPSY.md for the full honesty boundary.
# ---------------------------------------------------------------------------


class RootCauseCategory(str, Enum):
    PAYMENT_INFRASTRUCTURE = "payment_infrastructure"
    CUSTOMER = "customer"
    CHECKOUT = "checkout"
    RECOVERY = "recovery"
    POLICY = "policy"
    UNKNOWN_MULTI_FACTOR = "unknown_multi_factor"


class RevenueOutcome(str, Enum):
    NATURAL_RECOVERY = "natural_recovery"
    INTERVENTION_RECOVERY = "intervention_recovery"
    RECOVERABLE = "recoverable"
    PERMANENTLY_LOST = "permanently_lost"
    UNRESOLVED = "unresolved"


AUTOPSY_NOTE = (
    "Offline / synthetic analysis using the existing synthetic failed-payment "
    "population, the existing RVE audit log, and a documented synthetic "
    "realized-outcome layer (see docs/REVENUE_RECOVERY_AUTOPSY.md). This does "
    "not establish production causal relationships and is not live gateway "
    "or bank diagnosis -- root causes are attributed under documented "
    "deterministic rules, not proven, and preventability figures are "
    "estimates under simulated conditions, not guarantees."
)


class ContributingCause(BaseModel):
    cause_key: str
    label: str
    detail: str


class ForensicPaymentRecord(BaseModel):
    payment_id: str
    customer_id: str
    amount: float
    failure_reason: FailureReason
    transaction_type: TransactionType
    payment_method: str
    gateway: str
    checkout_started_at: datetime
    payment_attempted_at: datetime
    failed_at: datetime
    recovery_decision_at: Optional[datetime] = None
    recovery_executed_at: Optional[datetime] = None
    recovered_at: Optional[datetime] = None
    chosen_intervention: Optional[str] = None
    probability_of_recovery: Optional[float] = None
    expected_value: Optional[float] = None
    recovered: Optional[bool] = None
    outcome: RevenueOutcome
    primary_cause_key: str
    primary_cause_category: RootCauseCategory
    primary_cause_label: str
    contributing_causes: List[ContributingCause]
    recovery_decision_delay_hours: Optional[float] = None
    time_to_recovery_hours: Optional[float] = None
    preventable_amount: float


class RevenueLeakageSummary(BaseModel):
    total_at_risk: float
    total_recovered: float
    natural_recovery_amount: float
    intervention_recovery_amount: float
    revenue_lost: float
    recoverable_amount: float
    permanently_lost_amount: float
    unresolved_amount: float
    preventable_amount: float
    n_payments: int
    n_natural_recovery: int
    n_intervention_recovery: int
    n_recoverable: int
    n_permanently_lost: int
    n_unresolved: int
    definitions: Dict[str, str]


class LossChainBreakdownItem(BaseModel):
    label: str
    count: int
    amount: float
    percentage_of_total: float


class LossChainStage(BaseModel):
    stage: str
    label: str
    count: int
    amount: float
    percentage_of_total: float
    note: Optional[str] = None
    breakdown: List[LossChainBreakdownItem] = Field(default_factory=list)


class RecoveryDelayBucket(BaseModel):
    label: str
    n_payments: int
    n_recovered: int
    recovery_rate: float


class RecoveryDelayAnalysis(BaseModel):
    buckets: List[RecoveryDelayBucket]
    mean_time_to_first_intervention_hours: Optional[float] = None
    mean_time_to_recovery_hours: Optional[float] = None
    disclaimer: str = (
        "Association observed in simulation, not a proven causal relationship. "
        "Recovery appears to decline as delay increases in this synthetic batch; "
        "this does not establish that delay causes recovery failure."
    )


class ParetoResult(BaseModel):
    top_share_of_causes: float
    revenue_share: float
    concentration_detected: bool
    statement: str


class RevenueAutopsySummaryResponse(BaseModel):
    leakage: RevenueLeakageSummary
    loss_chain: List[LossChainStage]
    recovery_delay: RecoveryDelayAnalysis
    pareto: ParetoResult
    note: str = AUTOPSY_NOTE


class RootCauseDetail(BaseModel):
    cause_key: str
    category: RootCauseCategory
    label: str
    kind: str  # "primary" | "contributing"
    n_payments: int
    amount: float
    # This cause's own share of total revenue at risk. NOT additive across
    # the full `causes` list: the 6 `kind="primary"` rows are a true
    # partition and sum to ~100%, but `kind="contributing"` rows overlap
    # both primary causes and each other (a payment can carry several), so
    # summing percentage_of_total across ALL rows overshoots 100% by design
    # -- found and documented during the forensic-integrity audit, not
    # currently rendered as a column in the UI, but flagged here so no
    # future consumer of this API mistakes it for a partition.
    percentage_of_total: float
    recovery_rate: float
    preventable_amount: float
    preventability_factor: float
    mean_recovery_delay_hours: Optional[float] = None
    top_intervention: Optional[str] = None
    note: Optional[str] = None


class FixFirstOpportunity(BaseModel):
    priority: int
    cause_key: str
    category: RootCauseCategory
    label: str
    revenue_affected: float
    preventable_amount: float
    feasibility: float
    estimated_fix_cost: float
    opportunity_score: float
    expected_value_of_fix: float
    why: str


class RevenueAutopsyCausesResponse(BaseModel):
    causes: List[RootCauseDetail]
    fix_first: List[FixFirstOpportunity]
    top_recommendation: Optional[FixFirstOpportunity] = None
    formula_note: str = (
        "Preventable revenue = category revenue x preventability factor. "
        "Opportunity score = preventable revenue x feasibility / estimated fix "
        "cost. Feasibility and fix-cost figures are illustrative, hand-picked "
        "assumptions for demonstrating the ranking methodology, not derived "
        "from real implementation-cost data. Opportunity buckets are not "
        "mutually exclusive (a payment can have one primary cause and "
        "multiple contributing causes), so bucket amounts should not be "
        "summed as a partition of total revenue -- see the leakage summary "
        "for the mutually-exclusive outcome partition."
    )
    note: str = AUTOPSY_NOTE


class RevenueAutopsyPaymentsResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[ForensicPaymentRecord]
    note: str = AUTOPSY_NOTE


# ---------------------------------------------------------------------------
# Recovery Negotiation Engine (negotiation_engine.py)
#
# A higher-level layer over RVE's own per-payment decision: RVE picks WHICH
# intervention (InterventionId above); this engine takes that choice as given
# and searches HOW MUCH incentive (in Rs.) is worth attaching to it, to
# maximize expected NET value -- not just recovery probability. It never
# replaces RVE's own choice, never calls Razorpay, and never appends to the
# RVE audit log -- analysis-only. See docs/RECOVERY_NEGOTIATION_ENGINE.md.
# ---------------------------------------------------------------------------


NEGOTIATION_NOTE = (
    "Offline / model-based estimate on synthetic data. Baseline (Rs. 0) "
    "probability comes from the real trained RVE model; every incentive "
    "level above that uses a documented, explicitly synthetic response "
    "curve -- not real customer discount-response data. See "
    "docs/RECOVERY_NEGOTIATION_ENGINE.md."
)


class NegotiationAnalyzeRequest(BaseModel):
    payment_id: str
    min_incentive: float = Field(default=0.0, ge=0.0)
    max_incentive: float = Field(default=500.0, ge=0.0)
    step: float = Field(default=50.0, gt=0.0)
    optimization_tolerance: float = Field(default=0.95, gt=0.0, le=1.0)


class NegotiationCandidateModel(BaseModel):
    incentive: float
    eligible: bool
    blocked_reason: Optional[str] = None
    # Populated ONLY when eligible=True -- a blocked candidate is never
    # assigned an EV (docs/RECOVERY_NEGOTIATION_ENGINE.md Section 8:
    # eligibility is decided before any economic computation, never the
    # reverse).
    recovery_probability: Optional[float] = None
    incremental_recovery: Optional[float] = None
    incentive_cost: Optional[float] = None
    intervention_cost: Optional[float] = None
    expected_gross_recovery: Optional[float] = None
    expected_net_value: Optional[float] = None


class NegotiationAnalyzeResponse(BaseModel):
    payment_id: str
    amount: float
    failure_reason: FailureReason
    customer_id: str
    # RVE's own choice, unmodified -- this engine never decides WHICH
    # intervention, only HOW MUCH incentive to attach to the one RVE picked.
    base_intervention: str
    base_probability: float
    base_expected_value: float
    candidates: List[NegotiationCandidateModel]
    # Three deliberately DISTINCT outcomes (docs/RECOVERY_NEGOTIATION_ENGINE.md
    # Section 9) -- never collapsed into one "the answer" field.
    # minimum_effective_intervention is a tolerance-relative statement, never
    # "the optimal intervention" (that is optimum_candidate).
    max_recovery_probability_candidate: Optional[float] = None
    optimum_candidate: Optional[float] = None
    minimum_effective_intervention: Optional[float] = None
    optimization_tolerance: float
    margin_protected: Optional[float] = None
    explanation: str
    note: str = NEGOTIATION_NOTE


# ---------------------------------------------------------------------------
# GET /decide/demo/timing-preview/{scenario}
#
# A heuristic PREVIEW of action x timing joint optimization -- domain-
# informed illustrative curves, not a fitted model. Standalone: never
# touches main._run_decision, optimizer.py, evaluator.py, or
# recovery_lab.py, never appends to the audit log. See
# app/timing_preview.py and docs/ROADMAP.md.
# ---------------------------------------------------------------------------


class TimingBucketCandidate(BaseModel):
    bucket_id: str
    bucket_label: str
    probability_of_recovery: float
    expected_value: float
    is_recommended: bool


class TimingPreviewResponse(BaseModel):
    scenario: str
    payment_id: str
    customer_id: str
    amount: float
    failure_reason: FailureReason
    transaction_type: TransactionType
    retry_count_so_far: int
    # The action this preview assumes is ALREADY decided (by the live
    # optimizer, in a real flow) -- this preview only ever answers "when",
    # never "which action". Cost is looked up from the real intervention
    # menu, never invented.
    action_intervention_id: str
    action_unit_cost: float
    description: str
    candidates: List[TimingBucketCandidate]
    recommended_bucket_id: str
    recommended_bucket_label: str
    # False for a flat/near-flat curve (e.g. card_expired): timing isn't the
    # lever for this failure reason, and timing_not_the_lever_note explains
    # why instead of the UI showing an unexplained flat recommendation.
    timing_lever_relevant: bool
    timing_not_the_lever_note: Optional[str] = None
    is_heuristic_preview: bool
    note: str
