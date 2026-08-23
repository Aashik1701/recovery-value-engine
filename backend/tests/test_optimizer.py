import pytest

from app.optimizer import select_best_intervention


def test_selects_highest_ev_among_eligible() -> None:
    ev_by_intervention = {"no_action": 10.0, "retry_now": 50.0, "voice_call": 200.0}
    chosen = select_best_intervention(ev_by_intervention, eligible_ids=["no_action", "retry_now", "voice_call"])
    assert chosen == "voice_call"


def test_ignores_ineligible_interventions_even_if_higher_ev() -> None:
    ev_by_intervention = {"no_action": 10.0, "retry_now": 50.0, "voice_call": 200.0}
    # voice_call has the highest EV but is not eligible (e.g. blocked by guardrail)
    chosen = select_best_intervention(ev_by_intervention, eligible_ids=["no_action", "retry_now"])
    assert chosen == "retry_now"


def test_single_eligible_intervention_is_returned() -> None:
    ev_by_intervention = {"no_action": 10.0, "retry_now": 50.0}
    chosen = select_best_intervention(ev_by_intervention, eligible_ids=["no_action"])
    assert chosen == "no_action"


def test_raises_on_empty_eligible_list() -> None:
    with pytest.raises(ValueError):
        select_best_intervention({"no_action": 10.0}, eligible_ids=[])


def test_negative_ev_still_picks_the_least_bad_option() -> None:
    ev_by_intervention = {"no_action": -5.0, "voice_call": -20.0}
    chosen = select_best_intervention(ev_by_intervention, eligible_ids=["no_action", "voice_call"])
    assert chosen == "no_action"
