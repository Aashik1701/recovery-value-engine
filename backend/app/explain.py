"""Explanation generation: the ONLY component in this system that calls an LLM.

Everything upstream (probability model, EV math, optimizer, guardrails) is
classical and deterministic -- a decision that moves money needs to be
reproducible, debuggable, and auditable. Converting that structured decision
into a short, readable rationale for an operator is a natural-language
generation task, which is what LLMs are good at.

If ANTHROPIC_API_KEY is not set, falls back to a deterministic
template-based explanation so the rest of the system still runs without a
live key. The dark-pattern keyword scan (guardrails.py) always runs on the
final output, live or templated, before it's returned.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from app.formatting import format_inr_digits_decimal
from app.guardrails import scan_for_dark_patterns

_ANTHROPIC_MODEL = "claude-sonnet-4-5"

SYSTEM_PROMPT = (
    "You are writing a one-to-two sentence internal note for a payments-ops "
    "reviewer explaining why an automated system chose a specific recovery "
    "action for a failed payment. Ground your explanation ONLY in the fields "
    "given to you. Be factual and concise. Never use urgency, scarcity, or "
    "confirm-shaming language (e.g. 'hurry', 'act now', 'last chance') -- "
    "this note is for an internal ops reviewer, not a customer-facing message."
)


def _build_user_prompt(
    chosen_intervention: str,
    probability: float,
    unit_cost: float,
    expected_value: float,
    amount: float,
    failure_reason: str,
    transaction_type: str,
    retry_count_so_far: int,
) -> str:
    return (
        f"Chosen intervention: {chosen_intervention}\n"
        f"Predicted probability of recovery: {probability:.2%}\n"
        f"Unit cost: Rs.{unit_cost:.2f}\n"
        f"Expected value: Rs.{expected_value:.2f}\n"
        f"Payment amount: Rs.{amount:.2f}\n"
        f"Failure reason: {failure_reason}\n"
        f"Transaction type: {transaction_type}\n"
        f"Retries so far: {retry_count_so_far}\n\n"
        "Write the ops note now."
    )


def _template_explanation(
    chosen_intervention: str,
    probability: float,
    unit_cost: float,
    expected_value: float,
    amount: float,
    failure_reason: str,
    transaction_type: str,
    retry_count_so_far: int,
) -> str:
    """Deterministic fallback used when no ANTHROPIC_API_KEY is configured."""
    return (
        f"Chose '{chosen_intervention}' for this {transaction_type} payment of Rs.{format_inr_digits_decimal(amount)} "
        f"(failure reason: {failure_reason}, {retry_count_so_far} prior retries). "
        f"Predicted recovery probability is {probability:.1%} at a cost of Rs.{unit_cost:.2f}, "
        f"giving an expected value of Rs.{format_inr_digits_decimal(expected_value)} -- the highest among eligible options."
    )


def escalation_note(candidate: str, spread: float, threshold: float) -> str:
    """Deterministic note for an escalated decision -- NEVER calls the LLM, so
    the project's "exactly one LLM call in the whole system" claim stays
    literally true. An escalated decision is a non-decision: there is no
    chosen channel to explain, only why the system declined to choose."""
    return (
        f"Escalated: model confidence too low for autonomous action. The bootstrap "
        f"ensemble's disagreement (std dev) on the top-ranked action ('{candidate}') "
        f"is {spread:.1%}, at or above the escalation threshold of {threshold:.1%} "
        f"(the 95th percentile of held-out ensemble disagreement). A human reviewer "
        f"should decide this one rather than the optimizer committing to a number "
        f"the models don't agree on."
    )


def suppression_note(failure_reason: str, policy_id: str) -> str:
    """Deterministic note for a decision the hard risk policy suppressed --
    NEVER calls the LLM, so the project's "exactly one LLM call in the whole
    system" claim stays literally true. A suppressed decision is a
    non-decision: there is no chosen channel to explain, only why recovery
    was prohibited. The model may still have assigned the payment a nonzero
    recovery probability -- that number is left on the audit record's
    per-intervention EVs -- but policy, not economics, is what decided this."""
    return (
        f"Recovery suppressed by risk policy '{policy_id}': this payment's failure "
        f"reason is '{failure_reason}'. The risk policy takes precedence over the "
        f"recovery-probability model and the expected-value optimizer -- no retry, "
        f"contact channel, incentive, confidence escalation, or payment-link action "
        f"is permitted. Selected action: no_action. Any recovery probability shown "
        f"for other actions is the model's estimate, not a permitted option."
    )


def generate_explanation(
    chosen_intervention: str,
    probability: float,
    unit_cost: float,
    expected_value: float,
    amount: float,
    failure_reason: str,
    transaction_type: str,
    retry_count_so_far: int,
) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    text: Optional[str] = None

    if api_key:
        try:
            import anthropic  # local import: keep anthropic optional at module load time

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=_ANTHROPIC_MODEL,
                max_tokens=200,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": _build_user_prompt(
                            chosen_intervention, probability, unit_cost, expected_value,
                            amount, failure_reason, transaction_type, retry_count_so_far,
                        ),
                    }
                ],
            )
            text = "".join(
                block.text for block in response.content if getattr(block, "type", None) == "text"
            ).strip()
        except Exception:
            # Any live-API failure (network, auth, rate limit, ...) falls back
            # to the deterministic template rather than breaking the pipeline.
            text = None

    if not text:
        text = _template_explanation(
            chosen_intervention, probability, unit_cost, expected_value,
            amount, failure_reason, transaction_type, retry_count_so_far,
        )

    # Guardrail: scan the final text (LLM or template) for dark-pattern
    # phrasing. If anything slips through the LLM call, fall back to the
    # safe deterministic template instead of returning flagged text.
    matches = scan_for_dark_patterns(text)
    if matches:
        text = _template_explanation(
            chosen_intervention, probability, unit_cost, expected_value,
            amount, failure_reason, transaction_type, retry_count_so_far,
        )

    return text
