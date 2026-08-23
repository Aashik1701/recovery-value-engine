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
        f"Chose '{chosen_intervention}' for this {transaction_type} payment of Rs.{amount:,.2f} "
        f"(failure reason: {failure_reason}, {retry_count_so_far} prior retries). "
        f"Predicted recovery probability is {probability:.1%} at a cost of Rs.{unit_cost:.2f}, "
        f"giving an expected value of Rs.{expected_value:,.2f} -- the highest among eligible options."
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
