"""Revenue Recovery Autopsy -- revenue-loss forensics and root-cause analysis.

RVE (the rest of this backend) decides what to do with ONE already-failed
payment right now. This module is a different, higher-level question: given
the synthetic failed-payment batch and the decisions RVE already made for
it, WHY did this revenue leak, how much of it was preventable or is still
recoverable, and what should the merchant fix first. It is a read-only
analysis layer -- it never calls Razorpay, never appends to the RVE audit
log, and never re-scores the probability model. Every probability/EV number
it shows is read straight out of the AuditRecord `/decide` already produced
(CLAUDE.md's "reuse existing APIs, don't recalculate EV" rule).

Like evaluator.py and recovery_lab.py, this module is one of the few places
allowed to read the hidden `_simulator_truth` table -- for one specific,
documented reason explained below, not a general exception.

----------------------------------------------------------------------------
Why this module needs a new synthetic field, and how it's generated
----------------------------------------------------------------------------
Nothing in RVE today records whether a payment ACTUALLY recovered. The audit
log only stores the decision (probability, EV, chosen intervention) at
decision time -- there is no realized outcome anywhere in the system, because
RVE's job stops at "which intervention has the highest EV," not "did it
work." Classifying revenue into natural/intervention/recoverable/
permanently-lost/unresolved structurally requires a realized outcome.

Per the project's own honesty-boundary rule ("add a clearly documented
synthetic field to the simulator/data generator" when a metric can't be
derived from existing fields), this module draws one: a single seeded
Bernoulli sample per payment from
`clip(base_recovery_prob + uplift_by_intervention[chosen_intervention] +
noise, 0, 1)` -- the IDENTICAL formula `simulator.generate_training_logs`
already uses to sample `observed_outcome`. This is not a new methodology;
it's the same, already-reviewed sampling approach applied once more, here
for offline post-hoc forensic labeling instead of training-data generation.
It is drawn fresh, deterministically, from a stream seeded off the current
simulation's seed -- never stored back into `training_logs` or exposed to
the probability model.

The forensic lifecycle timestamps (checkout/attempt/decision/execution/
recovered) are ALSO new and synthetic -- documented, deterministic, seeded
off the same stream, and deliberately independent of the REAL wall-clock
`AuditRecord.decided_at` (which stays untouched and keeps meaning "when this
API call actually ran" for the real audit trail). Ordering is enforced by
construction (each stage is the previous stage plus a non-negative offset).

The realized-outcome draw also applies a documented "recovery-timeliness
decay" multiplier as a function of the synthetic recovery-decision delay
(same family of assumption as simulator.py's own retry-count "customer
fatigue" factor). Without this, the delay would have no generative
relationship at all to the outcome, and the recovery-delay-bucket analysis
(Section 19 of the Revenue Recovery Autopsy task) would be reporting pure
sampling noise dressed up as a finding rather than an actual, disclosed
synthetic regularity.

----------------------------------------------------------------------------
Honesty boundaries specific to this module
----------------------------------------------------------------------------
- `payment_method` and `gateway` do not exist anywhere else in this codebase.
  They are added here, synthetically, because the loss-chain's METHOD/GATEWAY
  stages and the PAYMENT_INFRASTRUCTURE taxonomy branch structurally need
  them -- not to make the UI look richer. Hand-picked, documented
  distributions, sampled independently of `failure_reason` (no fabricated
  causal link between method/gateway choice and why a payment failed).
- Every failed payment in this dataset already reached checkout and a
  payment attempt (CLAUDE.md Section 4: RVE's unit of analysis IS an
  already-attempted failed payment) -- there is no abandoned-checkout
  population here. The loss chain's CUSTOMER/CHECKOUT/PAYMENT_ATTEMPT stages
  are therefore always 100% pass-through by dataset construction, and this
  module does NOT fabricate a "checkout abandonment revenue" figure. CHECKOUT
  remains in the taxonomy only for a contributing-cause tag on individual
  payments (elevated synthetic checkout latency), never as a standalone
  revenue bucket with its own attempted-vs-abandoned population.
- Primary cause is a direct, 1:1, documented relabeling of the existing
  `failure_reason` field into a taxonomy category -- not an inference.
  Contributing causes ARE inferred from deterministic rules over existing or
  newly-added signals, and are always labeled "Attributed cause" in the API
  and UI, never presented as proven causality.
- Fix-First "opportunity buckets" (primary causes + 4 contributing-cause
  tags) are NOT mutually exclusive -- a single payment can count toward more
  than one bucket's `revenue_affected` (it has exactly one primary cause but
  can have several contributing causes). This is normal for a prioritization
  ranking, but it means bucket amounts must never be summed and presented as
  a partition of total revenue. The mutually-exclusive partition is the
  5-way `RevenueOutcome` classification in the leakage summary, which is
  computed from a single if/elif chain per payment (never independent
  booleans) specifically so it can never double-count.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set

import numpy as np
import pandas as pd

from app.guardrails import apply_guardrails, full_menu
from app.models import (
    NON_CONTACT_INTERVENTIONS,
    AuditRecord,
    ContributingCause,
    FixFirstOpportunity,
    ForensicPaymentRecord,
    LossChainBreakdownItem,
    LossChainStage,
    ParetoResult,
    RecoveryDelayAnalysis,
    RecoveryDelayBucket,
    RevenueAutopsyCausesResponse,
    RevenueAutopsyPaymentsResponse,
    RevenueAutopsySummaryResponse,
    RevenueLeakageSummary,
    RevenueOutcome,
    RootCauseCategory,
    RootCauseDetail,
)
from app.pss_simulator import PAYMENT_METHODS

# ---------------------------------------------------------------------------
# Documented, hand-picked assumptions (same spirit as simulator.py's own
# UPLIFT_BY_REASON_AND_INTERVENTION disclaimer -- not fitted to real data,
# because there is none; chosen to give the taxonomy internal structure).
# ---------------------------------------------------------------------------

RECOVERY_WINDOW_HOURS = 168.0  # 7 days -- same default horizon as recovery_lab.py
RECOVERY_DELAY_THRESHOLD_HOURS = 2.0  # "delayed" contributing-cause threshold
CHECKOUT_LATENCY_THRESHOLD_SECONDS = 8.0
PARETO_CONCENTRATION_THRESHOLD = 0.5

PAYMENT_METHOD_WEIGHTS = [0.42, 0.33, 0.15, 0.10]  # upi, card, netbanking, wallet -- hand-picked

GATEWAYS = ["gateway_primary", "gateway_secondary", "bank_direct"]
GATEWAY_WEIGHTS = [0.55, 0.30, 0.15]
GATEWAY_LABELS = {
    "gateway_primary": "Primary gateway",
    "gateway_secondary": "Secondary gateway",
    "bank_direct": "Direct bank debit",
}

# The single source of truth for every "opportunity bucket" this module
# reports: the 6 primary causes (1:1 with `failure_reason`) plus 4
# contributing-cause tags. `preventability` drives "potentially preventable
# revenue"; `feasibility`/`fix_cost` drive the Fix-First opportunity score.
# All three columns are illustrative, hand-picked assumptions -- documented
# here, never presented as measured or guaranteed.
OPPORTUNITY_BUCKETS: Dict[str, Dict[str, object]] = {
    "bank_timeout": dict(
        label="Bank / issuer timeout", kind="primary", category=RootCauseCategory.PAYMENT_INFRASTRUCTURE,
        preventability=0.55, feasibility=0.4, fix_cost=500_000.0,
    ),
    "network_error": dict(
        label="Gateway network error", kind="primary", category=RootCauseCategory.PAYMENT_INFRASTRUCTURE,
        preventability=0.55, feasibility=0.4, fix_cost=450_000.0,
    ),
    "fraud_block": dict(
        label="Issuer fraud block", kind="primary", category=RootCauseCategory.PAYMENT_INFRASTRUCTURE,
        preventability=0.05, feasibility=0.15, fix_cost=300_000.0,
    ),
    "insufficient_funds": dict(
        label="Insufficient funds", kind="primary", category=RootCauseCategory.CUSTOMER,
        preventability=0.15, feasibility=0.3, fix_cost=150_000.0,
    ),
    "card_expired": dict(
        label="Expired card", kind="primary", category=RootCauseCategory.CUSTOMER,
        preventability=0.70, feasibility=0.6, fix_cost=200_000.0,
    ),
    "other": dict(
        label="Unclassified / multi-factor", kind="primary", category=RootCauseCategory.UNKNOWN_MULTI_FACTOR,
        preventability=0.20, feasibility=0.2, fix_cost=100_000.0,
    ),
    "recovery_delay": dict(
        label="Recovery delay", kind="contributing", category=RootCauseCategory.RECOVERY,
        preventability=0.60, feasibility=0.9, fix_cost=50_000.0,
    ),
    "repeated_retries": dict(
        label="Repeated retries before recovery", kind="contributing", category=RootCauseCategory.RECOVERY,
        preventability=0.25, feasibility=0.6, fix_cost=80_000.0,
    ),
    "guardrail_blocking": dict(
        label="Guardrail-blocked higher-value action", kind="contributing", category=RootCauseCategory.POLICY,
        preventability=0.50, feasibility=0.7, fix_cost=100_000.0,
    ),
    "checkout_latency": dict(
        label="Elevated checkout latency (simulated)", kind="contributing", category=RootCauseCategory.CHECKOUT,
        preventability=0.35, feasibility=0.5, fix_cost=150_000.0,
    ),
}

PRIMARY_CAUSE_KEYS = [k for k, v in OPPORTUNITY_BUCKETS.items() if v["kind"] == "primary"]
CONTRIBUTING_CAUSE_KEYS = [k for k, v in OPPORTUNITY_BUCKETS.items() if v["kind"] == "contributing"]

LEAKAGE_DEFINITIONS: Dict[str, str] = {
    "revenue_lost": "Amount that ultimately remained unrecovered (revenue at risk minus natural and intervention recovery).",
    "recovered": "Amount recovered after failure, whether organically (no intervention) or after an RVE intervention.",
    "preventable": (
        "Amount associated with a failure class that this analysis' documented, hand-picked assumptions treat as "
        "plausibly preventable -- potentially preventable, not a guarantee, and not restricted to unrecovered payments."
    ),
    "recoverable": (
        "Amount still eligible for a valid recovery intervention under the existing RVE guardrails and the "
        f"{int(RECOVERY_WINDOW_HOURS / 24)}-day recovery window, but not yet recovered."
    ),
    "permanently_lost": "Amount for which the recovery window has expired or every eligible recovery path is exhausted.",
    "unresolved": "Amount for which no RVE decision record could be found -- insufficient evidence to classify.",
}


@dataclass
class ForensicRecordInternal:
    payment_id: str
    customer_id: str
    amount: float
    failure_reason: str
    transaction_type: str
    payment_method: str
    gateway: str
    checkout_started_at: datetime
    payment_attempted_at: datetime
    failed_at: datetime
    recovery_decision_at: Optional[datetime]
    recovery_executed_at: Optional[datetime]
    recovered_at: Optional[datetime]
    chosen_intervention: Optional[str]
    probability_of_recovery: Optional[float]
    expected_value: Optional[float]
    recovered: Optional[bool]
    outcome: RevenueOutcome
    contributing: List[ContributingCause]
    recovery_decision_delay_hours: Optional[float]
    time_to_recovery_hours: Optional[float]
    preventable_amount: float


def _derive_seed(seed: int) -> int:
    """A distinct-but-deterministic derived seed so re-simulating with the
    same top-level seed reproduces the same forensic dataset, without this
    module's draws sharing an identical stream position with any other
    seeded-from-the-same-seed generator (simulator.py's own training-log
    generation, PSS's simulator, ...)."""
    return int((seed * 1_000_003 + 7) % (2**31 - 1))


def _latest_audit_by_payment(audit_log: List[AuditRecord]) -> Dict[str, AuditRecord]:
    latest: Dict[str, AuditRecord] = {}
    for record in audit_log:
        latest[record.payment_id] = record  # audit_log is append-ordered -> last write wins
    return latest


def _contact_counts(audit_log: List[AuditRecord]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for record in audit_log:
        if record.chosen_intervention not in NON_CONTACT_INTERVENTIONS:
            counts[record.payment_id] = counts.get(record.payment_id, 0) + 1
    return counts


def build_forensic_dataset(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    audit_log: List[AuditRecord],
    suppression_list: Set[str],
    seed: int,
    now: Optional[datetime] = None,
) -> List[ForensicRecordInternal]:
    """Build one ForensicRecordInternal per payment in `batch_payments_df`.

    Deterministic for a given (seed, batch, audit_log, suppression_list):
    payments are processed in payment_id-sorted order against a single seeded
    RNG stream, the same idiom simulator.py itself uses.
    """
    reference_now = now or datetime.utcnow()
    latest_audit = _latest_audit_by_payment(audit_log)
    contact_counts = _contact_counts(audit_log)
    hidden_truth_by_id = hidden_truth_df.set_index("payment_id").to_dict(orient="index")

    sorted_payments = batch_payments_df.sort_values("payment_id").reset_index(drop=True)
    rng = np.random.default_rng(_derive_seed(seed))

    records: List[ForensicRecordInternal] = []
    for _, payment in sorted_payments.iterrows():
        pid = str(payment["payment_id"])
        failed_at: datetime = payment["failed_at"]
        amount = float(payment["amount"])
        failure_reason = str(payment["failure_reason"])

        # --- synthetic lifecycle timeline (deterministic, documented) ------
        checkout_gap_s = float(np.clip(rng.gamma(2.0, 1.5), 0.5, 30.0))
        attempt_gap_s = float(np.clip(rng.gamma(2.0, 1.0), 0.3, 15.0))
        payment_attempted_at = failed_at - timedelta(seconds=attempt_gap_s)
        checkout_started_at = payment_attempted_at - timedelta(seconds=checkout_gap_s)

        payment_method = str(rng.choice(PAYMENT_METHODS, p=PAYMENT_METHOD_WEIGHTS))
        gateway = str(rng.choice(GATEWAYS, p=GATEWAY_WEIGHTS))

        audit = latest_audit.get(pid)

        preventable_amount = amount * float(OPPORTUNITY_BUCKETS[_bucket_key_for_reason(failure_reason)]["preventability"])

        if audit is None:
            # UNRESOLVED: no RVE decision record exists for this payment --
            # insufficient evidence to classify recovery, but the failure
            # class itself (and therefore preventability) is still known.
            records.append(
                ForensicRecordInternal(
                    payment_id=pid, customer_id=str(payment["customer_id"]), amount=amount,
                    failure_reason=failure_reason, transaction_type=str(payment["transaction_type"]),
                    payment_method=payment_method, gateway=gateway,
                    checkout_started_at=checkout_started_at, payment_attempted_at=payment_attempted_at,
                    failed_at=failed_at, recovery_decision_at=None, recovery_executed_at=None, recovered_at=None,
                    chosen_intervention=None, probability_of_recovery=None, expected_value=None, recovered=None,
                    outcome=RevenueOutcome.UNRESOLVED, contributing=[],
                    recovery_decision_delay_hours=None, time_to_recovery_hours=None,
                    preventable_amount=preventable_amount,
                )
            )
            continue

        chosen = audit.chosen_intervention
        chosen_ev_entry = next((e for e in audit.all_evs if e.intervention_id == chosen), None)
        probability = chosen_ev_entry.probability_of_recovery if chosen_ev_entry else 0.0
        expected_value = chosen_ev_entry.expected_value if chosen_ev_entry else 0.0

        decision_delay_hours = float(np.clip(rng.exponential(6.0), 0.02, 120.0))
        recovery_decision_at = failed_at + timedelta(hours=decision_delay_hours)
        execution_gap_min = int(rng.integers(1, 15))
        recovery_executed_at = recovery_decision_at + timedelta(minutes=execution_gap_min)

        truth = hidden_truth_by_id.get(pid, {"base_recovery_prob": 0.0, "uplift_by_intervention": {}})
        uplift = truth["uplift_by_intervention"].get(chosen, 0.0)
        # Recovery-timeliness decay: a documented, deliberate synthetic
        # assumption (same family as simulator.py's own retry-count "customer
        # fatigue" factor) -- the longer a recovery decision is delayed after
        # failure, the less effective it is, modeling customer disengagement
        # / channel staleness. Without this, decision_delay_hours would have
        # NO relationship at all to the realized outcome, and the recovery
        # -delay-bucket analysis below would just be reporting sampling
        # noise dressed up as a finding. Floored at 0.35 so a very long delay
        # degrades but never zeroes out recovery odds outright.
        delay_decay = float(np.clip(1.0 - 0.02 * decision_delay_hours, 0.35, 1.0))
        true_prob = float(np.clip((truth["base_recovery_prob"] + uplift) * delay_decay + rng.normal(0, 0.03), 0.0, 1.0))
        recovered = bool(rng.random() < true_prob)

        recovered_at: Optional[datetime] = None
        time_to_recovery_hours: Optional[float] = None
        if recovered:
            completion_delay_hours = float(np.clip(rng.exponential(6.0), 0.05, 120.0))
            recovered_at = recovery_executed_at + timedelta(hours=completion_delay_hours)
            time_to_recovery_hours = (recovered_at - failed_at).total_seconds() / 3600.0

        # --- outcome classification (single if/elif chain -> exhaustive, ---
        # --- mutually exclusive by construction, never double-counted) -----
        if chosen == "no_action" and recovered:
            outcome = RevenueOutcome.NATURAL_RECOVERY
        elif chosen != "no_action" and recovered:
            outcome = RevenueOutcome.INTERVENTION_RECOVERY
        else:
            hours_since_failure = (reference_now - failed_at).total_seconds() / 3600.0
            eligible, _ = apply_guardrails(
                full_menu(), amount, str(payment["customer_id"]), suppression_list,
                prior_contact_count=contact_counts.get(pid, 0),
            )
            # Excluding NON_CONTACT_INTERVENTIONS (not just "no_action") here
            # is deliberate, found during the forensic-integrity audit:
            # retry_now is a NON_CONTACT_INTERVENTION and is therefore
            # guardrail-eligible under EVERY condition (suppression, contact
            # cap, and the voice-amount threshold all explicitly exempt it --
            # see guardrails.py). Checking only `- {"no_action"}` meant
            # `has_further_action` was always True until the recovery window
            # expired, making the "or all eligible recovery paths are
            # exhausted" half of PERMANENTLY_LOST's own definition dead code
            # -- a suppressed customer or one who'd hit the contact cap would
            # still be classified RECOVERABLE, which is not what "eligible
            # recovery paths exhausted" is supposed to mean. Excluding the
            # whole non-contact set means RECOVERABLE now requires a genuine
            # customer-facing channel still being available, not just the
            # always-on automatic retry.
            has_further_action = bool(set(eligible) - NON_CONTACT_INTERVENTIONS)
            if hours_since_failure <= RECOVERY_WINDOW_HOURS and has_further_action:
                outcome = RevenueOutcome.RECOVERABLE
            else:
                outcome = RevenueOutcome.PERMANENTLY_LOST

        # --- contributing causes (deterministic rules, existing signals) ---
        contributing: List[ContributingCause] = []
        if decision_delay_hours > RECOVERY_DELAY_THRESHOLD_HOURS:
            contributing.append(
                ContributingCause(
                    cause_key="recovery_delay", label="Recovery delay",
                    detail=f"Attributed cause (simulated root-cause attribution): recovery decision made "
                    f"{decision_delay_hours:.1f}h after failure.",
                )
            )
        if int(payment["retry_count_so_far"]) >= 2:
            contributing.append(
                ContributingCause(
                    cause_key="repeated_retries", label="Repeated retries before recovery",
                    detail=f"Attributed cause (simulated root-cause attribution): "
                    f"{int(payment['retry_count_so_far'])} prior retries recorded before this attempt.",
                )
            )
        if chosen_ev_entry is not None:
            blocked_higher = [
                e for e in audit.all_evs if not e.eligible and e.expected_value > chosen_ev_entry.expected_value
            ]
            if blocked_higher:
                best_blocked = max(blocked_higher, key=lambda e: e.expected_value)
                contributing.append(
                    ContributingCause(
                        cause_key="guardrail_blocking", label="Guardrail-blocked higher-value action",
                        detail=f"Attributed cause (simulated root-cause attribution): {best_blocked.intervention_id} "
                        f"had a higher expected value (Rs.{best_blocked.expected_value:.2f}) but was blocked "
                        f"({best_blocked.blocked_reason or 'guardrail'}).",
                    )
                )
        if checkout_gap_s > CHECKOUT_LATENCY_THRESHOLD_SECONDS:
            contributing.append(
                ContributingCause(
                    cause_key="checkout_latency", label="Elevated checkout latency (simulated)",
                    detail=f"Attributed cause (simulated root-cause attribution): checkout-to-attempt gap of "
                    f"{checkout_gap_s:.1f}s, above the {CHECKOUT_LATENCY_THRESHOLD_SECONDS:.0f}s reference.",
                )
            )

        records.append(
            ForensicRecordInternal(
                payment_id=pid, customer_id=str(payment["customer_id"]), amount=amount,
                failure_reason=failure_reason, transaction_type=str(payment["transaction_type"]),
                payment_method=payment_method, gateway=gateway,
                checkout_started_at=checkout_started_at, payment_attempted_at=payment_attempted_at,
                failed_at=failed_at, recovery_decision_at=recovery_decision_at,
                recovery_executed_at=recovery_executed_at, recovered_at=recovered_at,
                chosen_intervention=chosen, probability_of_recovery=probability, expected_value=expected_value,
                recovered=recovered, outcome=outcome, contributing=contributing,
                recovery_decision_delay_hours=decision_delay_hours, time_to_recovery_hours=time_to_recovery_hours,
                preventable_amount=preventable_amount,
            )
        )

    return records


def _bucket_key_for_reason(failure_reason: str) -> str:
    return failure_reason if failure_reason in OPPORTUNITY_BUCKETS else "other"


def _to_api_record(r: ForensicRecordInternal) -> ForensicPaymentRecord:
    bucket_key = _bucket_key_for_reason(r.failure_reason)
    bucket = OPPORTUNITY_BUCKETS[bucket_key]
    return ForensicPaymentRecord(
        payment_id=r.payment_id, customer_id=r.customer_id, amount=round(r.amount, 2),
        failure_reason=r.failure_reason, transaction_type=r.transaction_type,
        payment_method=r.payment_method, gateway=r.gateway,
        checkout_started_at=r.checkout_started_at, payment_attempted_at=r.payment_attempted_at,
        failed_at=r.failed_at, recovery_decision_at=r.recovery_decision_at,
        recovery_executed_at=r.recovery_executed_at, recovered_at=r.recovered_at,
        chosen_intervention=r.chosen_intervention,
        probability_of_recovery=round(r.probability_of_recovery, 4) if r.probability_of_recovery is not None else None,
        expected_value=round(r.expected_value, 2) if r.expected_value is not None else None,
        recovered=r.recovered, outcome=r.outcome,
        primary_cause_key=bucket_key, primary_cause_category=bucket["category"], primary_cause_label=bucket["label"],
        contributing_causes=r.contributing,
        recovery_decision_delay_hours=round(r.recovery_decision_delay_hours, 2) if r.recovery_decision_delay_hours is not None else None,
        time_to_recovery_hours=round(r.time_to_recovery_hours, 2) if r.time_to_recovery_hours is not None else None,
        preventable_amount=round(r.preventable_amount, 2),
    )


def compute_summary(records: List[ForensicRecordInternal]) -> RevenueLeakageSummary:
    total_at_risk = sum(r.amount for r in records)
    natural = sum(r.amount for r in records if r.outcome == RevenueOutcome.NATURAL_RECOVERY)
    intervention = sum(r.amount for r in records if r.outcome == RevenueOutcome.INTERVENTION_RECOVERY)
    recoverable = sum(r.amount for r in records if r.outcome == RevenueOutcome.RECOVERABLE)
    permanently_lost = sum(r.amount for r in records if r.outcome == RevenueOutcome.PERMANENTLY_LOST)
    unresolved = sum(r.amount for r in records if r.outcome == RevenueOutcome.UNRESOLVED)
    total_recovered = natural + intervention
    preventable = sum(r.preventable_amount for r in records)

    def _count(outcome: RevenueOutcome) -> int:
        return sum(1 for r in records if r.outcome == outcome)

    return RevenueLeakageSummary(
        total_at_risk=round(total_at_risk, 2),
        total_recovered=round(total_recovered, 2),
        natural_recovery_amount=round(natural, 2),
        intervention_recovery_amount=round(intervention, 2),
        revenue_lost=round(total_at_risk - total_recovered, 2),
        recoverable_amount=round(recoverable, 2),
        permanently_lost_amount=round(permanently_lost, 2),
        unresolved_amount=round(unresolved, 2),
        preventable_amount=round(preventable, 2),
        n_payments=len(records),
        n_natural_recovery=_count(RevenueOutcome.NATURAL_RECOVERY),
        n_intervention_recovery=_count(RevenueOutcome.INTERVENTION_RECOVERY),
        n_recoverable=_count(RevenueOutcome.RECOVERABLE),
        n_permanently_lost=_count(RevenueOutcome.PERMANENTLY_LOST),
        n_unresolved=_count(RevenueOutcome.UNRESOLVED),
        definitions=LEAKAGE_DEFINITIONS,
    )


def compute_loss_chain(records: List[ForensicRecordInternal]) -> List[LossChainStage]:
    total_amount = sum(r.amount for r in records) or 1.0  # guard against /0 on an empty batch
    n = len(records)
    n_customers = len({r.customer_id for r in records})

    def pct(amount: float) -> float:
        return round(amount / total_amount * 100, 2)

    stages: List[LossChainStage] = [
        LossChainStage(
            stage="customer", label="Customer", count=n_customers, amount=round(total_amount, 2),
            percentage_of_total=100.0,
            note="Distinct customers with at least one failed payment in this batch.",
        ),
        LossChainStage(
            stage="checkout", label="Checkout", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            note="Every record in this dataset already reached checkout (RVE's unit of analysis is an "
            "already-attempted failed payment, see CLAUDE.md Section 4) -- abandoned-checkout revenue "
            "prior to an attempt is not observable in this data and is not estimated here.",
        ),
        LossChainStage(
            stage="payment_attempt", label="Payment attempt", count=n, amount=round(total_amount, 2),
            percentage_of_total=100.0,
        ),
    ]

    def _breakdown(key_fn, labels: Optional[Dict[str, str]] = None) -> List[LossChainBreakdownItem]:
        buckets: Dict[str, List[ForensicRecordInternal]] = {}
        for r in records:
            buckets.setdefault(key_fn(r), []).append(r)
        items = []
        for key, rows in buckets.items():
            amt = sum(x.amount for x in rows)
            items.append(
                LossChainBreakdownItem(
                    label=(labels or {}).get(key, key), count=len(rows), amount=round(amt, 2),
                    percentage_of_total=pct(amt),
                )
            )
        return sorted(items, key=lambda i: i.amount, reverse=True)

    stages.append(
        LossChainStage(
            stage="method", label="Method", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            note="Share of failed-payment revenue by payment method (synthetic attribution, not a loss point).",
            breakdown=_breakdown(lambda r: r.payment_method),
        )
    )
    stages.append(
        LossChainStage(
            stage="gateway", label="Gateway / bank", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            note="Share of failed-payment revenue by gateway/bank route (synthetic attribution, not a loss point).",
            breakdown=_breakdown(lambda r: r.gateway, GATEWAY_LABELS),
        )
    )
    stages.append(
        LossChainStage(
            stage="failure", label="Failure", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            note="Every payment here has already failed; the breakdown is by primary cause.",
            breakdown=_breakdown(lambda r: OPPORTUNITY_BUCKETS[_bucket_key_for_reason(r.failure_reason)]["label"]),
        )
    )

    recovered_amt = sum(r.amount for r in records if r.outcome in (RevenueOutcome.NATURAL_RECOVERY, RevenueOutcome.INTERVENTION_RECOVERY))
    not_recovered_amt = total_amount - recovered_amt
    stages.append(
        LossChainStage(
            stage="recovery", label="Recovery", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            breakdown=[
                LossChainBreakdownItem(label="Recovered", count=sum(1 for r in records if r.outcome in (RevenueOutcome.NATURAL_RECOVERY, RevenueOutcome.INTERVENTION_RECOVERY)), amount=round(recovered_amt, 2), percentage_of_total=pct(recovered_amt)),
                LossChainBreakdownItem(label="Not yet recovered", count=sum(1 for r in records if r.outcome not in (RevenueOutcome.NATURAL_RECOVERY, RevenueOutcome.INTERVENTION_RECOVERY)), amount=round(not_recovered_amt, 2), percentage_of_total=pct(not_recovered_amt)),
            ],
        )
    )

    outcome_labels = {
        RevenueOutcome.NATURAL_RECOVERY: "Natural recovery",
        RevenueOutcome.INTERVENTION_RECOVERY: "Intervention recovery",
        RevenueOutcome.RECOVERABLE: "Recoverable",
        RevenueOutcome.PERMANENTLY_LOST: "Permanently lost",
        RevenueOutcome.UNRESOLVED: "Unresolved",
    }
    stages.append(
        LossChainStage(
            stage="outcome", label="Outcome", count=n, amount=round(total_amount, 2), percentage_of_total=100.0,
            breakdown=_breakdown(lambda r: outcome_labels[r.outcome]),
        )
    )
    return stages


DELAY_BUCKET_EDGES = [(0, 1, "<1h"), (1, 4, "1-4h"), (4, 12, "4-12h"), (12, 24, "12-24h"), (24, float("inf"), ">24h")]


def compute_recovery_delay(records: List[ForensicRecordInternal]) -> RecoveryDelayAnalysis:
    decided = [r for r in records if r.recovery_decision_delay_hours is not None]
    buckets: List[RecoveryDelayBucket] = []
    for lo, hi, label in DELAY_BUCKET_EDGES:
        in_bucket = [r for r in decided if lo <= r.recovery_decision_delay_hours < hi]
        n_recovered = sum(1 for r in in_bucket if r.recovered)
        buckets.append(
            RecoveryDelayBucket(
                label=label, n_payments=len(in_bucket), n_recovered=n_recovered,
                recovery_rate=round(n_recovered / len(in_bucket), 4) if in_bucket else 0.0,
            )
        )
    mean_decision = sum(r.recovery_decision_delay_hours for r in decided) / len(decided) if decided else None
    recovered_rows = [r for r in decided if r.time_to_recovery_hours is not None]
    mean_recovery = sum(r.time_to_recovery_hours for r in recovered_rows) / len(recovered_rows) if recovered_rows else None
    return RecoveryDelayAnalysis(
        buckets=buckets,
        mean_time_to_first_intervention_hours=round(mean_decision, 2) if mean_decision is not None else None,
        mean_time_to_recovery_hours=round(mean_recovery, 2) if mean_recovery is not None else None,
    )


def compute_pareto(records: List[ForensicRecordInternal]) -> ParetoResult:
    """Computed ONLY over the mutually-exclusive PRIMARY-cause partition
    (never the overlapping contributing-cause buckets), so this specific
    statistic can never double-count."""
    total = sum(r.amount for r in records) or 1.0
    by_cause: Dict[str, float] = {}
    for r in records:
        key = _bucket_key_for_reason(r.failure_reason)
        by_cause[key] = by_cause.get(key, 0.0) + r.amount
    n_categories = len(by_cause) or 1
    top_n = max(1, round(0.2 * n_categories))
    ranked = sorted(by_cause.values(), reverse=True)
    revenue_share = sum(ranked[:top_n]) / total
    detected = revenue_share >= PARETO_CONCENTRATION_THRESHOLD
    top_share_of_causes = top_n / n_categories
    if detected:
        statement = (
            f"The top {top_n} of {n_categories} failure categories account for "
            f"{revenue_share * 100:.0f}% of revenue at risk."
        )
    else:
        statement = (
            f"No dominant concentration detected -- the top {top_n} of {n_categories} failure categories "
            f"account for only {revenue_share * 100:.0f}% of revenue at risk."
        )
    return ParetoResult(
        top_share_of_causes=round(top_share_of_causes, 4), revenue_share=round(revenue_share, 4),
        concentration_detected=detected, statement=statement,
    )


def compute_causes_and_fix_first(records: List[ForensicRecordInternal]) -> tuple[List[RootCauseDetail], List[FixFirstOpportunity]]:
    total_amount = sum(r.amount for r in records) or 1.0

    bucket_rows: Dict[str, List[ForensicRecordInternal]] = {k: [] for k in OPPORTUNITY_BUCKETS}
    for r in records:
        bucket_rows[_bucket_key_for_reason(r.failure_reason)].append(r)
        for c in r.contributing:
            bucket_rows.setdefault(c.cause_key, []).append(r)

    causes: List[RootCauseDetail] = []
    fix_first: List[FixFirstOpportunity] = []
    for key, meta in OPPORTUNITY_BUCKETS.items():
        rows = bucket_rows.get(key, [])
        amount = sum(r.amount for r in rows)
        n_payments = len(rows)
        recovered_n = sum(1 for r in rows if r.outcome in (RevenueOutcome.NATURAL_RECOVERY, RevenueOutcome.INTERVENTION_RECOVERY))
        preventability = float(meta["preventability"])
        preventable = amount * preventability
        delays = [r.recovery_decision_delay_hours for r in rows if r.recovery_decision_delay_hours is not None]
        interventions = [r.chosen_intervention for r in rows if r.chosen_intervention]
        top_intervention = max(set(interventions), key=interventions.count) if interventions else None

        note = None
        if key == "checkout_latency":
            note = "Contributing-cause tag only; this dataset has no observable pre-attempt checkout population, see docs/REVENUE_RECOVERY_AUTOPSY.md."

        if n_payments > 0 or meta["kind"] == "primary":
            causes.append(
                RootCauseDetail(
                    cause_key=key, category=meta["category"], label=meta["label"], kind=meta["kind"],
                    n_payments=n_payments, amount=round(amount, 2),
                    percentage_of_total=round(amount / total_amount * 100, 2),
                    recovery_rate=round(recovered_n / n_payments, 4) if n_payments else 0.0,
                    preventable_amount=round(preventable, 2), preventability_factor=preventability,
                    mean_recovery_delay_hours=round(sum(delays) / len(delays), 2) if delays else None,
                    top_intervention=top_intervention, note=note,
                )
            )

        # A bucket with zero affected payments (a contributing tag nothing
        # triggered, or a primary cause that happened not to occur in this
        # batch) has nothing to rank -- ₹0 opportunity is not a priority, and
        # showing it in the Fix-First ranking would be confusing clutter,
        # not a correctness issue (the underlying zero is real). Skip it
        # here; it still appears in `causes` when it's a primary bucket, so
        # the taxonomy stays visibly complete there.
        if n_payments == 0:
            continue

        feasibility = float(meta["feasibility"])
        fix_cost = float(meta["fix_cost"])
        opportunity_score = (preventable * feasibility / fix_cost) if fix_cost > 0 else 0.0
        expected_value_of_fix = preventable * feasibility
        fix_first.append(
            FixFirstOpportunity(
                priority=0,  # assigned after sorting, below
                cause_key=key, category=meta["category"], label=meta["label"],
                revenue_affected=round(amount, 2), preventable_amount=round(preventable, 2),
                feasibility=feasibility, estimated_fix_cost=fix_cost,
                opportunity_score=round(opportunity_score, 6), expected_value_of_fix=round(expected_value_of_fix, 2),
                why=f"Rs.{preventable:,.0f} potentially preventable across {n_payments:,} payments, "
                f"feasibility {feasibility:.1f} and estimated fix cost Rs.{fix_cost:,.0f}.",
            )
        )

    causes.sort(key=lambda c: (-c.amount, c.cause_key))
    fix_first.sort(key=lambda f: (-f.opportunity_score, f.cause_key))
    for i, item in enumerate(fix_first, start=1):
        item.priority = i

    return causes, fix_first


# ---------------------------------------------------------------------------
# Top-level orchestration -- what main.py's routes actually call. Kept thin
# and route-shaped on purpose, same division of labor as recovery_lab.py's
# run_recovery_lab_simulation/run_sensitivity_sweep functions.
# ---------------------------------------------------------------------------


def get_summary_response(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    audit_log: List[AuditRecord],
    suppression_list: Set[str],
    seed: int,
) -> RevenueAutopsySummaryResponse:
    records = build_forensic_dataset(batch_payments_df, customers_df, hidden_truth_df, audit_log, suppression_list, seed)
    return RevenueAutopsySummaryResponse(
        leakage=compute_summary(records),
        loss_chain=compute_loss_chain(records),
        recovery_delay=compute_recovery_delay(records),
        pareto=compute_pareto(records),
    )


def get_causes_response(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    audit_log: List[AuditRecord],
    suppression_list: Set[str],
    seed: int,
) -> RevenueAutopsyCausesResponse:
    records = build_forensic_dataset(batch_payments_df, customers_df, hidden_truth_df, audit_log, suppression_list, seed)
    causes, fix_first = compute_causes_and_fix_first(records)
    return RevenueAutopsyCausesResponse(
        causes=causes, fix_first=fix_first, top_recommendation=fix_first[0] if fix_first else None,
    )


def get_payments_response(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    audit_log: List[AuditRecord],
    suppression_list: Set[str],
    seed: int,
    page: int,
    page_size: int,
    cause: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
) -> RevenueAutopsyPaymentsResponse:
    records = build_forensic_dataset(batch_payments_df, customers_df, hidden_truth_df, audit_log, suppression_list, seed)

    filtered = records
    if cause:
        filtered = [
            r for r in filtered
            if _bucket_key_for_reason(r.failure_reason) == cause or any(c.cause_key == cause for c in r.contributing)
        ]
    if status:
        filtered = [r for r in filtered if r.outcome.value == status]
    if search:
        needle = search.strip().lower()
        filtered = [r for r in filtered if needle in r.payment_id.lower() or needle in r.customer_id.lower()]

    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = filtered[start:end]

    return RevenueAutopsyPaymentsResponse(
        total=total, page=page, page_size=page_size, items=[_to_api_record(r) for r in page_rows],
    )
