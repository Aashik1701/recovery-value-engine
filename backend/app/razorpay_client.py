"""Razorpay test-mode payment-link generation.

This is the one intervention in the system that hits a real external API
(CLAUDE.md Section 6, Section 14 Phase 5) -- everything else (SMS, WhatsApp,
email, voice) is logged/simulated only, per Section 16's explicit scope
boundary. When the optimizer chooses `sms_link`, this module creates a real
Razorpay test-mode payment link for the failed payment's amount.

If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET aren't set, or the API call fails
for any reason (network, auth, rate limit), this returns None rather than
raising -- the decision pipeline must not break because a live payment
provider is unreachable. That failure is a deliberate, documented
degradation, not a silent one: main.py logs it into the audit record's
`payment_link_error` field so the dashboard can show what happened rather
than just an absent link.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class PaymentLinkResult:
    url: Optional[str] = None
    error: Optional[str] = None


def create_payment_link(
    payment_id: str, amount: float, customer_id: str, decision_id: str
) -> PaymentLinkResult:
    key_id = os.environ.get("RAZORPAY_KEY_ID")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET")

    if not key_id or not key_secret:
        return PaymentLinkResult(error="RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured")

    try:
        import razorpay  # local import: keep the SDK optional at module load time

        client = razorpay.Client(auth=(key_id, key_secret))
        # Razorpay amounts are in paise, not rupees.
        link = client.payment_link.create(
            {
                "amount": int(round(amount * 100)),
                "currency": "INR",
                "description": f"Recovery Value Engine -- retry for payment {payment_id}",
                # Scoped to the decision, not the payment: /decide isn't
                # idempotent (each call logs a fresh audit record), and
                # Razorpay rejects a second link creation with a
                # previously-used reference_id. payment_id/customer_id stay
                # in notes for traceability back to the original payment.
                "reference_id": f"rve_{decision_id}",
                "notes": {"payment_id": payment_id, "customer_id": customer_id},
            }
        )
        return PaymentLinkResult(url=link.get("short_url"))
    except Exception as exc:  # network, auth, rate limit, malformed response, ...
        return PaymentLinkResult(error=str(exc))
