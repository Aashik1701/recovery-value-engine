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
