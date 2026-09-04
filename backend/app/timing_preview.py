"""Optimal Recovery Timing -- heuristic PREVIEW, not the shipped feature.

See docs/Timing preview brief.md (the spec this module implements exactly)
and docs/ROADMAP.md (what full implementation would require).

Every recovery decision actually has three questions: *whether* to recover
at all (already exists, ev_engine.py/optimizer.py), *what* action to take
(already exists, same modules), and *when* to take it (this module,
preview only). This module answers only the third question, and only with
domain-informed illustrative curves -- not a fitted model.

Hard boundary (do not weaken this): nothing here is imported by
main._run_decision, optimizer.py, evaluator.py, or recovery_lab.py. This
module is self-contained, called from exactly one standalone endpoint
(GET /decide/demo/timing-preview/{scenario} in main.py), and never appends
to the audit log or touches any batch/model/simulation state. Every response
carries is_heuristic_preview=True and an illustrative-not-fitted note --
that note must never be dropped from a response, and this table must never
be described as "the model" anywhere it's surfaced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from app.models import INTERVENTION_UNIT_COSTS

# ---------------------------------------------------------------------------
# Section 2 of the brief -- exact values, not rounded or adjusted.
# ---------------------------------------------------------------------------

TIMING_BUCKET_IDS: List[str] = ["now", "plus_30min", "plus_2h", "plus_6h", "tomorrow_am", "tomorrow_pm"]

TIMING_BUCKET_LABELS: Dict[str, str] = {
    "now": "Now",
    "plus_30min": "+30 min",
    "plus_2h": "+2h",
    "plus_6h": "+6h",
    "tomorrow_am": "Tomorrow AM",
    "tomorrow_pm": "Tomorrow PM",
}

# failure_reason -> bucket_id -> illustrative probability of recovery.
# `fraud_block` is deliberately absent: this preview never produces a timing
# recommendation for it, the same way it's excluded from contact-based
# interventions in the live guardrails (app.guardrails) -- consistency with
# that existing decision matters more than completeness here.
HEURISTIC_TIMING_CURVES: Dict[str, Dict[str, float]] = {
    "insufficient_funds": {
        "now": 0.12, "plus_30min": 0.14, "plus_2h": 0.18,
        "plus_6h": 0.25, "tomorrow_am": 0.45, "tomorrow_pm": 0.55,
    },
    "bank_timeout": {
        "now": 0.70, "plus_30min": 0.65, "plus_2h": 0.55,
        "plus_6h": 0.45, "tomorrow_am": 0.35, "tomorrow_pm": 0.30,
    },
    "network_error": {
        "now": 0.68, "plus_30min": 0.63, "plus_2h": 0.52,
        "plus_6h": 0.42, "tomorrow_am": 0.32, "tomorrow_pm": 0.28,
    },
    "card_expired": {
        "now": 0.02, "plus_30min": 0.02, "plus_2h": 0.02,
        "plus_6h": 0.02, "tomorrow_am": 0.02, "tomorrow_pm": 0.02,
    },
    "other": {
        "now": 0.30, "plus_30min": 0.30, "plus_2h": 0.28,
        "plus_6h": 0.26, "tomorrow_am": 0.24, "tomorrow_pm": 0.22,
    },
}

ILLUSTRATIVE_NOTE = "Illustrative timing curves, not fitted from data — see ROADMAP.md"

# Exact wording from the brief (Section 2): shown when the curve is flat
# enough that timing isn't the lever worth optimizing for this failure
# reason. Computed structurally from the curve's own spread (below), not by
# special-casing failure_reason == "card_expired" by name -- card_expired's
# flat curve trips it the same way any future flat curve would.
TIMING_NOT_THE_LEVER_NOTE = (
    "timing has negligible effect for this failure reason — the decision "
    "that matters here is which action, not when."
)
TIMING_LEVER_NEGLIGIBLE_SPREAD = 0.01  # max(curve) - min(curve) at/below this -> not the lever


# ---------------------------------------------------------------------------
# Section 3 of the brief -- hardcoded demo scenarios (nothing wired to the
# live batch or the live optimizer). `action_intervention_id` is treated as
# an ALREADY-decided action -- this preview only ever asks "when", never
# "which action"; its unit cost is looked up from the real, existing
# intervention menu (app.models.INTERVENTION_UNIT_COSTS), never invented.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Scenario:
    scenario_id: str
    payment_id: str
    customer_id: str
    amount: float
    failure_reason: str
    transaction_type: str
    retry_count_so_far: int
    action_intervention_id: str
    description: str


_SCENARIOS: Dict[str, _Scenario] = {
    "insufficient_funds_wait": _Scenario(
        scenario_id="insufficient_funds_wait",
        payment_id="pay_demo_timing_wait",
        customer_id="cust_demo_timing_wait",
        amount=8200.0,
        failure_reason="insufficient_funds",
        transaction_type="one_time",
        retry_count_so_far=0,
        action_intervention_id="retry_later",
        description=(
            "insufficient_funds: recovery probability plausibly rises with time "
            "(salary/cash-flow timing) -- the \"why tomorrow, not now\" case."
        ),
    ),
    "bank_timeout_now": _Scenario(
        scenario_id="bank_timeout_now",
        payment_id="pay_demo_timing_now",
        customer_id="cust_demo_timing_now",
        amount=3400.0,
        failure_reason="bank_timeout",
        transaction_type="one_time",
        retry_count_so_far=0,
        action_intervention_id="retry_now",
        description=(
            "bank_timeout: a transient technical failure -- waiting doesn't help and "
            "intent fades, so the heuristic recommends acting now, not waiting."
        ),
    ),
    "card_expired_flat": _Scenario(
        scenario_id="card_expired_flat",
        payment_id="pay_demo_timing_flat",
        customer_id="cust_demo_timing_flat",
        amount=5600.0,
        failure_reason="card_expired",
        transaction_type="subscription",
        retry_count_so_far=1,
        action_intervention_id="sms_link",
        description=(
            "card_expired: timing isn't the relevant lever at all -- the real answer is "
            "switching action (a payment link / new method), not waiting."
        ),
    ),
}


def list_scenario_ids() -> List[str]:
    return list(_SCENARIOS.keys())


class UnknownTimingScenario(KeyError):
    pass


class TimingPreviewNotAvailable(ValueError):
    """Raised for a failure_reason with no heuristic curve (fraud_block)."""


def build_timing_preview(scenario_id: str) -> dict:
    """Pure computation: heuristic curve lookup + EV(timing) per bucket +
    argmax recommendation, for one hardcoded demo scenario. No model, no
    optimizer, no batch/simulation state -- main.py's route is the only
    caller, and it never appends this to the audit log.
    """
    scenario = _SCENARIOS.get(scenario_id)
    if scenario is None:
        raise UnknownTimingScenario(scenario_id)

    curve = HEURISTIC_TIMING_CURVES.get(scenario.failure_reason)
    if curve is None:
        # fraud_block (or any future reason without a curve) never gets a
        # timing recommendation -- see module docstring.
        raise TimingPreviewNotAvailable(scenario.failure_reason)

    unit_cost = INTERVENTION_UNIT_COSTS[scenario.action_intervention_id]

    candidates = []
    for bucket_id in TIMING_BUCKET_IDS:
        prob = curve[bucket_id]
        candidates.append(
            {
                "bucket_id": bucket_id,
                "bucket_label": TIMING_BUCKET_LABELS[bucket_id],
                "probability_of_recovery": prob,
                "expected_value": prob * scenario.amount - unit_cost,
                "is_recommended": False,
            }
        )

    best = max(candidates, key=lambda c: c["expected_value"])
    best["is_recommended"] = True

    spread = max(curve.values()) - min(curve.values())
    timing_lever_relevant = spread > TIMING_LEVER_NEGLIGIBLE_SPREAD

    return {
        "scenario": scenario.scenario_id,
        "payment_id": scenario.payment_id,
        "customer_id": scenario.customer_id,
        "amount": scenario.amount,
        "failure_reason": scenario.failure_reason,
        "transaction_type": scenario.transaction_type,
        "retry_count_so_far": scenario.retry_count_so_far,
        "action_intervention_id": scenario.action_intervention_id,
        "action_unit_cost": unit_cost,
        "description": scenario.description,
        "candidates": candidates,
        "recommended_bucket_id": best["bucket_id"],
        "recommended_bucket_label": best["bucket_label"],
        "timing_lever_relevant": timing_lever_relevant,
        "timing_not_the_lever_note": None if timing_lever_relevant else TIMING_NOT_THE_LEVER_NOTE,
        "is_heuristic_preview": True,
        "note": ILLUSTRATIVE_NOTE,
    }
