"""Deterministic guardrails: a hard fraud-risk recovery-suppression policy,
plus the contact-frequency cap, voice-call threshold, suppression list, and a
dark-pattern keyword scan on generated explanations.

These filter the intervention menu BEFORE the optimizer's argmax runs, not
after -- an ineligible intervention is never allowed to be picked, no matter
its EV. The fraud-risk policy is the strongest of these: for a fraud-flagged
failure it collapses the eligible set to ``[no_action]`` before any EV is
even computed, so an unsafe recovery action is never scored, never selected,
and never executed.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set, Tuple

from app.models import (
    ALL_INTERVENTION_IDS,
    CONTACT_FREQUENCY_CAP,
    NON_CONTACT_INTERVENTIONS,
    VOICE_CALL_AMOUNT_THRESHOLD,
    FailureReason,
    InterventionId,
)

# ---------------------------------------------------------------------------
# Hard risk policy -- distinct in kind from the EV/optimization guardrails
# below. This is a trust-&-safety rule that takes precedence over the
# recovery-probability model, the EV optimizer, the Recovery Negotiation
# Engine, and every execution path. For a fraud-flagged failure the ONLY
# permitted recovery outcome is ``no_action``: no retry, no contact channel,
# no incentive, no confidence escalation, no Razorpay call.
#
# It is enforced HERE, at candidate-eligibility time, so an unsafe action is
# never even entered into argmax -- never "optimize an unsafe action, then
# reject it afterwards". One canonical decision
# (:func:`recovery_suppression_policy`) is consumed by the live decision
# pipeline, the Recovery Lab's RVE policy, the offline evaluator's RVE
# policy, the Negotiation Engine, and the execution boundary -- the rule is
# NOT re-implemented as scattered ``if failure_reason == "fraud_block"``
# checks across those modules.
# ---------------------------------------------------------------------------

FRAUD_BLOCK_RECOVERY_SUPPRESSION = "fraud_block_recovery_suppression"

# Failure reasons for which recovery is hard-suppressed by risk policy.
RISK_SUPPRESSED_FAILURE_REASONS = frozenset({FailureReason.FRAUD_BLOCK.value})

RECOVERY_SUPPRESSION_REASON = (
    "Blocked by risk policy (fraud_block): recovery is suppressed for "
    "fraud-flagged payments. This policy takes precedence over the "
    "recovery-probability model and the expected-value optimizer -- the "
    "only permitted action is no_action."
)


def recovery_suppression_policy(failure_reason: Optional[str]) -> Optional[str]:
    """The one canonical hard-suppression decision.

    Returns the policy id (:data:`FRAUD_BLOCK_RECOVERY_SUPPRESSION`) when
    recovery must be hard-suppressed for this ``failure_reason``, else
    ``None``. Every component that could otherwise initiate a recovery
    action -- a channel, a retry, an incentive, an escalation, or a Razorpay
    call -- for a fraud-flagged payment consults THIS function. The rule
    lives in exactly one place.
    """
    if failure_reason is not None and failure_reason in RISK_SUPPRESSED_FAILURE_REASONS:
        return FRAUD_BLOCK_RECOVERY_SUPPRESSION
    return None

# Lightweight, hardcoded phrase list for the dark-pattern scan. This is a
# safeguard, not a guarantee -- a determined prompt could still produce
# manipulative language this scan doesn't catch. It exists to catch the
# obvious cases (false urgency, confirm-shaming, fabricated scarcity).
DARK_PATTERN_PHRASES: List[str] = [
    "hurry",
    "act now",
    "act fast",
    "limited time",
    "last chance",
    "only 1 left",
    "only a few left",
    "don't miss out",
    "expires soon",
    "before it's too late",
    "act immediately",
    "final notice",
    "urgent action required",
]


def scan_for_dark_patterns(text: str) -> List[str]:
    """Return the list of dark-pattern phrases found in ``text`` (lowercased match)."""
    lowered = text.lower()
    return [phrase for phrase in DARK_PATTERN_PHRASES if phrase in lowered]


def apply_guardrails(
    candidate_intervention_ids: Iterable[str],
    amount: float,
    customer_id: str,
    suppression_list: Set[str],
    prior_contact_count: int = 0,
    contact_cap: int = CONTACT_FREQUENCY_CAP,
    failure_reason: Optional[str] = None,
) -> Tuple[List[str], Dict[str, str]]:
    """Filter a candidate intervention menu down to what's actually eligible.

    Returns (eligible_ids, blocked_reasons) where blocked_reasons maps every
    ineligible intervention_id to a short human-readable reason -- this is
    exactly what powers the "why not this action?" dashboard panel, sourced
    straight from the audit log with no extra computation.

    ``failure_reason`` gates the hard fraud-risk policy
    (:func:`recovery_suppression_policy`). When it names a risk-suppressed
    reason (``fraud_block``), the eligible set collapses to ``[no_action]``
    and every other candidate is blocked with
    :data:`RECOVERY_SUPPRESSION_REASON` -- checked FIRST, before the
    voice/suppression/contact-cap guardrails and before any EV is computed,
    so an unsafe action is never scored. Callers that leave it ``None``
    (the default) get the pre-existing behaviour unchanged.

    Simplification (documented): the contact-frequency cap is evaluated
    against ``prior_contact_count`` passed in by the caller. This single
    decision call always counts as 1 contact-in-progress; a full
    multi-decision history is not tracked in v1, so callers that don't pass
    a prior count implicitly treat this as the customer's first contact for
    this payment.

    ``contact_cap`` defaults to the RVE's fixed ``CONTACT_FREQUENCY_CAP``
    (=2) so every existing caller is unaffected; the Recovery Lab digital
    twin (see recovery_lab.py) passes a merchant-configurable value here
    instead, since "maximum contacts per customer" is one of its simulation
    controls.
    """
    blocked_reasons: Dict[str, str] = {}
    eligible: List[str] = []

    # Hard fraud-risk policy: precedes every other check. Nothing but
    # no_action survives, regardless of EV, model prediction, suppression
    # state, or contact history.
    if recovery_suppression_policy(failure_reason) is not None:
        for intervention_id in candidate_intervention_ids:
            if intervention_id == InterventionId.NO_ACTION.value:
                eligible.append(intervention_id)
            else:
                blocked_reasons[intervention_id] = RECOVERY_SUPPRESSION_REASON
        return eligible, blocked_reasons

    is_suppressed = customer_id in suppression_list
    is_over_contact_cap = prior_contact_count >= contact_cap

    for intervention_id in candidate_intervention_ids:
        if intervention_id == InterventionId.VOICE_CALL.value and amount < VOICE_CALL_AMOUNT_THRESHOLD:
            blocked_reasons[intervention_id] = (
                f"Blocked: voice_call requires amount >= Rs.{VOICE_CALL_AMOUNT_THRESHOLD:,.0f} "
                f"(this payment is Rs.{amount:,.2f})"
            )
            continue

        if is_suppressed and intervention_id not in NON_CONTACT_INTERVENTIONS:
            blocked_reasons[intervention_id] = (
                "Blocked: customer is on the suppression list (opted out of contact)"
            )
            continue

        if is_over_contact_cap and intervention_id not in NON_CONTACT_INTERVENTIONS:
            blocked_reasons[intervention_id] = (
                f"Blocked: contact-frequency cap reached "
                f"({prior_contact_count}/{contact_cap} contacts already made for this payment)"
            )
            continue

        eligible.append(intervention_id)

    return eligible, blocked_reasons


def full_menu() -> List[str]:
    return list(ALL_INTERVENTION_IDS)
