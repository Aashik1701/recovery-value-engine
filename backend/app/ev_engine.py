"""Expected-value computation for the intervention menu.

Deterministic, plain-Python arithmetic -- no ML, no LLM. Financial decisions
need to be auditable: EV = P(recovery) * amount - unit_cost.

Design note on ``no_action``: rather than hand-approximating an "organic
recovery estimate", we treat ``no_action`` as just another value the
``assigned_intervention`` feature can take. Because training_logs assigns
interventions (including no_action) uniformly at random, the probability
model natively learns P(recovery | context, no_action) -- i.e. the organic
recovery estimate falls directly out of the same model used for every other
intervention, with the same causal-inference guarantee. Its unit cost is 0
by definition.
"""

from __future__ import annotations

from typing import Dict

from app.models import INTERVENTION_UNIT_COSTS


def compute_ev_for_menu(probabilities: Dict[str, float], amount: float) -> Dict[str, float]:
    """EV per intervention_id given P(recovery) for each and the payment amount."""
    ev: Dict[str, float] = {}
    for intervention_id, probability in probabilities.items():
        unit_cost = INTERVENTION_UNIT_COSTS[intervention_id]
        ev[intervention_id] = probability * amount - unit_cost
    return ev


def compute_ev(probability: float, amount: float, intervention_id: str) -> float:
    """EV for a single intervention."""
    unit_cost = INTERVENTION_UNIT_COSTS[intervention_id]
    return probability * amount - unit_cost
