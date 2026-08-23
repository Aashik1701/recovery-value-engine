from app.ev_engine import compute_ev, compute_ev_for_menu
from app.models import INTERVENTION_UNIT_COSTS


def test_compute_ev_single_intervention() -> None:
    ev = compute_ev(probability=0.5, amount=1000.0, intervention_id="retry_now")
    assert ev == 0.5 * 1000.0 - INTERVENTION_UNIT_COSTS["retry_now"]


def test_compute_ev_no_action_has_zero_cost() -> None:
    ev = compute_ev(probability=0.2, amount=500.0, intervention_id="no_action")
    assert ev == 0.2 * 500.0


def test_compute_ev_for_menu_matches_single_calls() -> None:
    probabilities = {"no_action": 0.1, "retry_now": 0.3, "voice_call": 0.5}
    amount = 2000.0
    ev_menu = compute_ev_for_menu(probabilities, amount)

    for intervention_id, probability in probabilities.items():
        expected = compute_ev(probability, amount, intervention_id)
        assert ev_menu[intervention_id] == expected


def test_higher_probability_yields_higher_ev_for_same_intervention() -> None:
    low = compute_ev(probability=0.1, amount=1000.0, intervention_id="sms_link")
    high = compute_ev(probability=0.8, amount=1000.0, intervention_id="sms_link")
    assert high > low


def test_ev_can_be_negative_when_cost_exceeds_expected_revenue() -> None:
    ev = compute_ev(probability=0.01, amount=100.0, intervention_id="voice_call")
    assert ev < 0


def test_zero_amount_ev_equals_negative_unit_cost() -> None:
    """A ~₹0 failed payment is a degenerate edge case, not one guardrails or
    Pydantic validation (amount > 0) should ever let through in practice --
    but the pure EV function should still behave predictably, not divide by
    zero or otherwise misbehave, since it has no amount validation of its
    own by design (validation is the API boundary's job, not this module's)."""
    ev = compute_ev(probability=0.9, amount=0.0, intervention_id="sms_link")
    assert ev == -INTERVENTION_UNIT_COSTS["sms_link"]


def test_probability_zero_and_one_boundaries() -> None:
    assert compute_ev(probability=0.0, amount=1000.0, intervention_id="email") == -INTERVENTION_UNIT_COSTS["email"]
    assert compute_ev(probability=1.0, amount=1000.0, intervention_id="email") == 1000.0 - INTERVENTION_UNIT_COSTS["email"]


def test_large_amount_does_not_overflow_or_lose_precision() -> None:
    """Sanity check against a very high-value payment (e.g. a large B2B
    invoice) -- plain float arithmetic, so this should just scale linearly,
    not silently clamp or error."""
    ev = compute_ev(probability=0.5, amount=10_000_000.0, intervention_id="voice_call")
    assert ev == 5_000_000.0 - INTERVENTION_UNIT_COSTS["voice_call"]
