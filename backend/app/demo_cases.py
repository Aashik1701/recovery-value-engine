"""Deliberately-constructed decision contexts for the pitch.

Same principle as the API-timeout failure mode: don't hope the live batch
surfaces the moment you want to demo -- build it on purpose. This module
holds ONE synthetic context that reliably trips the confidence gate.

The trigger is genuine bootstrap-ensemble disagreement, which -- from a sweep
of the seed-42 batch -- lives NOT at the distribution's extremes (there the
members all agree) but at real decision boundaries: mid-size payments whose
context pulls P(recovery) toward ~0.5, where different bootstrap resamples
land on different answers. The values below are lifted from the
highest-disagreement payment in that sweep (ensemble std ~0.17, well above
the ~0.125 escalation threshold).

Nothing here is added to the batch, the audit population, or any pinned
number -- it is a standalone context served by GET /decide/demo/low-confidence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Tuple

# ---------------------------------------------------------------------------
# Canonical judge-walkthrough payment (see docs/PITCH_SCRIPT.md).
#
# Unlike the low-confidence case below, this is NOT a hand-built context --
# it is a REAL row in the deterministic seed-42 startup batch
# (`/simulate` with SimulateRequest() defaults is fully reproducible), found
# and live-verified during the demo-hardening pass. It is named here so the
# frontend and the canonical-demo endpoint agree on exactly one payment
# instead of relying on array order.
#
# Its documented story: ~Rs.3,013.68, insufficient_funds, 2 prior retries ->
# voice_call has the highest RAW expected value but is blocked by the
# Rs.5,000 voice threshold -> retry_later is the highest ELIGIBLE EV and is
# selected. GET /decide/demo/canonical serves this payment's decision from a
# NON-appending path, so opening it repeatedly (refresh, restart, re-open)
# never mutates the audit log or the contact-frequency count and always
# shows the same clean story.
CANONICAL_DEMO_PAYMENT_ID = "pay_2ff975708893"

# The safety-story counterpart: a real seed-42 fraud_block row that clears
# every amount threshold (Rs.5,195.26), so the model would have chased it --
# but the hard risk policy suppresses recovery to no_action. Served from the
# same non-appending demo path so the guided walkthrough is repeatable.
CANONICAL_DEMO_FRAUD_PAYMENT_ID = "pay_594a26af1f2e"

CANONICAL_DEMO_DESCRIPTION = (
    "A small (~Rs.3,013.68) insufficient_funds failure with 2 prior retries. "
    "voice_call scores the highest raw expected value on this payment but is "
    "blocked by the Rs.5,000 voice-call threshold; retry_later is the "
    "highest-EV eligible action and is what RVE selects -- a guardrail "
    "overriding the top-ranked economic option, not just a weak option "
    "losing on its own merits."
)

LOW_CONFIDENCE_DEMO_PAYMENT_ID = "pay_demo_lowconf"
LOW_CONFIDENCE_DEMO_CUSTOMER_ID = "cust_demo_lowconf"

LOW_CONFIDENCE_DEMO_DESCRIPTION = (
    "A mid-size (~Rs.14,500) network_error failure from a customer with a "
    "middling history (43% past success). The context puts P(recovery) right "
    "on the fence, so the bootstrap ensemble members -- each fit on a "
    "different resample of training_logs -- disagree sharply about it. The "
    "confidence gate hands it to a human instead of committing an action on a "
    "number the models don't agree on."
)


def build_low_confidence_demo() -> Tuple[dict, dict]:
    """Return (payment, customer) dicts shaped exactly like a batch row, for
    the shared decision pipeline (`main._run_decision`)."""
    payment = {
        "payment_id": LOW_CONFIDENCE_DEMO_PAYMENT_ID,
        "customer_id": LOW_CONFIDENCE_DEMO_CUSTOMER_ID,
        "amount": 14495.0,
        "failure_reason": "network_error",
        "transaction_type": "one_time",
        "failed_at": datetime.now(timezone.utc),
        "retry_count_so_far": 0,
    }
    customer = {
        "customer_id": LOW_CONFIDENCE_DEMO_CUSTOMER_ID,
        "ltv": 37071.0,
        "past_success_rate": 0.43,
        "preferred_channel": "none",
    }
    return payment, customer
