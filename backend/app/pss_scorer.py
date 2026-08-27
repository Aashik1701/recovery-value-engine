"""Deterministic method ranking for the Payment Success Score.

Unlike RVE's optimizer.py, this is NOT an expected-value optimization --
payment methods don't carry the recovery menu's differential unit costs, so
there's nothing to net against probability. This is a ranking problem:
call the trained model for every method under the given conditions, sort by
predicted P(success), and flag the top one as recommended. Guardrails
(contact caps, suppression lists) don't apply here either -- there's no
customer-contact dimension to a payment-method choice -- so this file
deliberately doesn't force RVE's guardrail shape onto a problem that
doesn't have it.

The "why" figure reported alongside the score is computed, not templated:
the same model is re-queried under a fixed healthy-conditions reference for
the same method, and the delta is reported. That keeps the explanation
grounded in an actual second model call rather than an LLM guess or a
hardcoded sentence -- consistent with this project's one-LLM-call-total
claim (see docs/PAYMENT_PAGE.md): there is no LLM anywhere in this path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from app.pss_model import PSSModel
from app.pss_simulator import PAYMENT_METHODS

# Reference point for "how does this compare to a healthy day" -- matches
# the healthy end of the ranges pss_simulator.py draws training data from.
HEALTHY_REFERENCE_CONDITIONS: Dict[str, float] = {
    "gateway_latency_ms": 100.0,
    "gateway_error_rate": 0.01,
    "traffic_load_index": 1.0,
    "merchant_uptime_pct": 99.8,
}


@dataclass
class MethodScore:
    method: str
    success_probability: float
    score: int
    recommended: bool


@dataclass
class ScoreResult:
    methods: List[MethodScore]  # sorted descending by success_probability
    recommended_method: str
    healthy_baseline_score: int  # recommended method's score under HEALTHY_REFERENCE_CONDITIONS
    delta_from_healthy: int


def _to_score(prob: float) -> int:
    return round(prob * 100)


def score_methods(model: PSSModel, conditions: Dict) -> ScoreResult:
    probs = model.predict_proba_matrix(conditions)
    ranked_methods = sorted(PAYMENT_METHODS, key=lambda m: probs[m], reverse=True)
    recommended = ranked_methods[0]

    methods = [
        MethodScore(
            method=m,
            success_probability=round(probs[m], 4),
            score=_to_score(probs[m]),
            recommended=(m == recommended),
        )
        for m in ranked_methods
    ]

    healthy_conditions = {
        **HEALTHY_REFERENCE_CONDITIONS,
        "amount": conditions.get("amount", 1000.0),
        "transaction_type": conditions.get("transaction_type", "one_time"),
    }
    healthy_probs = model.predict_proba_matrix(healthy_conditions)
    healthy_score = _to_score(healthy_probs[recommended])
    current_score = _to_score(probs[recommended])

    return ScoreResult(
        methods=methods,
        recommended_method=recommended,
        healthy_baseline_score=healthy_score,
        delta_from_healthy=current_score - healthy_score,
    )
