"""Confidence Display & Escalation -- see the feature brief.

Covers the escalation path independently of the default batch (brief Section
5/8): the ensemble trains, the spread signal is a real percentile of the
held-out disagreement distribution (not hardcoded), a deliberately-
constructed low-confidence context escalates, a normal context does not, and
the escalate path never calls the LLM.

Reuses the session-scoped `default_startup_model` fixture (tests/conftest.py)
so the ~90s model fit is shared with the Recovery Lab pinned-numbers test.
"""

from __future__ import annotations

import pytest

from app import main
from app.demo_cases import build_low_confidence_demo
from app.guardrails import full_menu
from app.models import ESCALATE
from app.probability_model import ProbabilityModel


# ---------------------------------------------------------------------------
# The confidence signal itself
# ---------------------------------------------------------------------------


def test_thresholds_are_calibrated_from_the_held_out_distribution(default_startup_model: ProbabilityModel) -> None:
    m = default_startup_model
    # Not None, strictly increasing, and in (0, 1) -- i.e. genuine quantiles
    # of a std-dev distribution, not magic constants.
    assert m.spread_p33 is not None and m.spread_p67 is not None and m.spread_p95 is not None
    assert 0.0 < m.spread_p33 < m.spread_p67 < m.spread_p95 < 1.0
    assert len(m.ensemble) == m.n_ensemble == 20


def test_predict_spread_matrix_shape_and_sign(default_startup_model: ProbabilityModel) -> None:
    payment, customer = build_low_confidence_demo()
    menu = full_menu()
    spreads = default_startup_model.predict_spread_matrix(payment, customer, menu)
    assert set(spreads) == set(menu)
    assert all(s >= 0.0 for s in spreads.values())


def test_confidence_tier_ordering(default_startup_model: ProbabilityModel) -> None:
    m = default_startup_model
    assert m.confidence_tier(m.spread_p33 - 1e-6) == "high"
    assert m.confidence_tier((m.spread_p33 + m.spread_p67) / 2) == "medium"
    assert m.confidence_tier(m.spread_p95 + 1e-6) == "low"
    assert m.should_escalate(m.spread_p95 + 1e-6) is True
    assert m.should_escalate(m.spread_p95 - 1e-6) is False


def test_predict_spread_requires_a_trained_ensemble() -> None:
    m = ProbabilityModel()
    with pytest.raises(RuntimeError):
        m.confidence_tier(0.1)


# ---------------------------------------------------------------------------
# The escalation decision, end to end, on a constructed low-confidence case
# ---------------------------------------------------------------------------


@pytest.fixture
def model_in_state(default_startup_model: ProbabilityModel):
    """Point main.state at the real ensemble-trained model for the duration
    of a test, then restore."""
    saved_model, saved_supp = main.state.model, main.state.suppression_list
    main.state.model = default_startup_model
    main.state.suppression_list = set()
    try:
        yield default_startup_model
    finally:
        main.state.model = saved_model
        main.state.suppression_list = saved_supp


def _decide_context(payment: dict, customer: dict):
    return main._run_decision(
        payment, customer, payment["payment_id"], prior_contact_count=0, live=False, append_to_log=False
    )


def test_low_confidence_demo_case_escalates(model_in_state) -> None:
    payment, customer = build_low_confidence_demo()
    resp = _decide_context(payment, customer)

    assert resp.chosen_intervention == ESCALATE
    rec = resp.audit_record
    assert rec.escalated is True
    assert rec.confidence_tier == "low"
    assert rec.chosen_probability_spread >= model_in_state.spread_p95
    assert "confidence" in resp.explanation.lower()
    # An escalated decision runs no channel and makes no Razorpay call.
    assert rec.payment_link_url is None and rec.payment_link_error is None
    assert rec.chosen_intervention == ESCALATE
    # Every intervention is still on the audit record, each with its spread.
    assert {e.intervention_id for e in rec.all_evs} == set(full_menu())
    assert all(e.probability_spread >= 0.0 for e in rec.all_evs)


def test_escalation_path_does_not_call_the_llm(model_in_state, monkeypatch) -> None:
    def _boom(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("generate_explanation (the LLM step) was called on an escalated decision")

    monkeypatch.setattr(main, "generate_explanation", _boom)
    payment, customer = build_low_confidence_demo()
    resp = _decide_context(payment, customer)  # would raise if the LLM step were hit
    assert resp.audit_record.escalated is True


def test_a_normal_context_is_not_escalated(model_in_state, default_startup_bundle) -> None:
    # A run-of-the-mill payment straight from the batch: the vast majority are
    # not in the worst 5% of ensemble disagreement.
    row = default_startup_bundle.batch_payments.iloc[0].to_dict()
    cust = (
        default_startup_bundle.customers.set_index("customer_id").loc[row["customer_id"]].to_dict()
    )
    cust["customer_id"] = row["customer_id"]
    resp = _decide_context(row, cust)
    assert resp.audit_record.escalated is False
    assert resp.chosen_intervention != ESCALATE
    assert resp.chosen_intervention in set(full_menu())
