"""Intervention selection: argmax EV over the guardrail-filtered menu.

Deterministic. Guardrails run first (see guardrails.py); the optimizer only
ever chooses among what's left eligible.
"""

from __future__ import annotations

from typing import Dict, List


def select_best_intervention(ev_by_intervention: Dict[str, float], eligible_ids: List[str]) -> str:
    """Pick the eligible intervention_id with the highest EV.

    Raises ValueError if ``eligible_ids`` is empty -- guardrails must always
    leave at least ``no_action`` eligible (it is never blocked by any
    guardrail in this system), so an empty eligible set indicates a bug
    upstream, not a legitimate "no valid choice" state.
    """
    if not eligible_ids:
        raise ValueError("No eligible interventions to choose from -- guardrails should always leave at least no_action eligible.")

    best_id = max(eligible_ids, key=lambda iid: ev_by_intervention[iid])
    return best_id
