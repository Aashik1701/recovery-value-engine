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
# /decide/{payment_id}
# ---------------------------------------------------------------------------


class InterventionEV(BaseModel):
    """One line of the audit trail: what an intervention would have cost/earned."""

    intervention_id: str
    probability_of_recovery: float
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
    decided_at: datetime
    all_evs: List[InterventionEV]
    chosen_intervention: str
    explanation: str
    # Only populated when chosen_intervention == "sms_link" -- the one
    # intervention that hits Razorpay's real test-mode API (CLAUDE.md
    # Section 14 Phase 5). Both null for every other intervention.
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


# ---------------------------------------------------------------------------
# /pss/score -- Payment Success Score (v2, see CLAUDE.md Section 20)
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
        "live signal from any real payment gateway. See CLAUDE.md Section 20."
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
    average_cost_per_recovery: float
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
