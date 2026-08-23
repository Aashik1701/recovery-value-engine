"""Deterministic guardrails: contact-frequency cap, voice-call threshold,
suppression list, and a dark-pattern keyword scan on generated explanations.

These filter the intervention menu BEFORE the optimizer's argmax runs, not
after -- an ineligible intervention is never allowed to be picked, no matter
its EV.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Set, Tuple

from app.models import (
    ALL_INTERVENTION_IDS,
    CONTACT_FREQUENCY_CAP,
    NON_CONTACT_INTERVENTIONS,
    VOICE_CALL_AMOUNT_THRESHOLD,
    InterventionId,
)

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
) -> Tuple[List[str], Dict[str, str]]:
    """Filter a candidate intervention menu down to what's actually eligible.

    Returns (eligible_ids, blocked_reasons) where blocked_reasons maps every
    ineligible intervention_id to a short human-readable reason -- this is
    exactly what powers the "why not this action?" dashboard panel, sourced
    straight from the audit log with no extra computation.

    Simplification (documented): the contact-frequency cap is evaluated
    against ``prior_contact_count`` passed in by the caller. This single
    decision call always counts as 1 contact-in-progress; a full
    multi-decision history is not tracked in v1, so callers that don't pass
    a prior count implicitly treat this as the customer's first contact for
    this payment.
    """
    blocked_reasons: Dict[str, str] = {}
    eligible: List[str] = []

    is_suppressed = customer_id in suppression_list
    is_over_contact_cap = prior_contact_count >= CONTACT_FREQUENCY_CAP

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
                f"({prior_contact_count}/{CONTACT_FREQUENCY_CAP} contacts already made for this payment)"
            )
            continue

        eligible.append(intervention_id)

    return eligible, blocked_reasons


def full_menu() -> List[str]:
    return list(ALL_INTERVENTION_IDS)
