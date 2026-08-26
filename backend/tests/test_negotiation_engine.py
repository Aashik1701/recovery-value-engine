"""Tests for the Recovery Negotiation Engine -- see negotiation_engine.py and
docs/RECOVERY_NEGOTIATION_ENGINE.md.

Matches this repo's per-module test style (test_ev_engine.py, test_guardrails.py,
test_recovery_lab.py): plain functions, bare assert, no mocking framework, a
handful of API-level tests via TestClient for endpoint wiring/validation.
"""

from __future__ import annotations

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.models import NegotiationAnalyzeRequest, NegotiationAnalyzeResponse, NegotiationCandidateModel


def test_models_importable() -> None:
    req = NegotiationAnalyzeRequest(payment_id="pay_test")
    assert req.min_incentive == 0.0
    assert req.max_incentive == 500.0
    assert req.step == 50.0
    assert req.optimization_tolerance == 0.95


from app import negotiation_engine


# ---------------------------------------------------------------------------
# Candidate ladder generation (docs Section 7)
# ---------------------------------------------------------------------------


def test_generate_incentive_ladder_inclusive_even_steps() -> None:
    levels = negotiation_engine.generate_incentive_ladder(0, 500, 50)
    assert levels == [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]


def test_generate_incentive_ladder_rejects_invalid_bounds() -> None:
    with pytest.raises(ValueError):
        negotiation_engine.generate_incentive_ladder(-10, 500, 50)
    with pytest.raises(ValueError):
        negotiation_engine.generate_incentive_ladder(100, 50, 50)
    with pytest.raises(ValueError):
        negotiation_engine.generate_incentive_ladder(0, 500, 0)


def test_generate_incentive_ladder_rejects_too_many_candidates() -> None:
    with pytest.raises(ValueError):
        negotiation_engine.generate_incentive_ladder(0, 1_000_000, 1)


# ---------------------------------------------------------------------------
# Incentive-response curve (docs Section 6) -- explicitly synthetic, deterministic
# ---------------------------------------------------------------------------


def test_incentive_response_probability_at_zero_returns_base_probability() -> None:
    p = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 0)
    assert p == 0.31


def test_incentive_response_probability_bounded_zero_to_one() -> None:
    p = negotiation_engine.incentive_response_probability(0.95, "insufficient_funds", 1_000_000)
    assert 0.0 <= p <= 1.0


def test_incentive_response_probability_fraud_block_never_uplifts() -> None:
    p = negotiation_engine.incentive_response_probability(0.05, "fraud_block", 500)
    assert p == 0.05


def test_incentive_response_probability_diminishing_returns() -> None:
    # Equal-sized incentive steps must produce SHRINKING probability gains --
    # the Hill/saturation curve's defining property. Not asserting a specific
    # shape beyond this, per CLAUDE.md Section 14 ("do not assume a bell curve").
    p0 = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 0)
    p1 = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 100)
    p2 = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 200)
    p3 = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 300)
    assert (p1 - p0) > (p2 - p1) > (p3 - p2) > 0


def test_incentive_response_probability_reproducible() -> None:
    a = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 137)
    b = negotiation_engine.incentive_response_probability(0.31, "insufficient_funds", 137)
    assert a == b


# ---------------------------------------------------------------------------
# Eligibility -- determined BEFORE any economic computation (docs Section 8)
# ---------------------------------------------------------------------------


def test_eligibility_blocks_fraud_block_incentives_above_zero() -> None:
    reasons = negotiation_engine.determine_candidate_eligibility(
        levels=[0, 100, 250],
        base_intervention_id="sms_link",
        base_eligible=True,
        base_blocked_reason=None,
        failure_reason="fraud_block",
        policy=negotiation_engine.DEFAULT_GUARDRAIL_POLICY,
    )
    assert reasons[0] is None
    assert reasons[100] is not None
    assert reasons[250] is not None


def test_eligibility_blocks_above_merchant_ceiling() -> None:
    policy = negotiation_engine.GuardrailPolicy(max_incentive=200.0)
    reasons = negotiation_engine.determine_candidate_eligibility(
        levels=[0, 100, 250],
        base_intervention_id="sms_link",
        base_eligible=True,
        base_blocked_reason=None,
        failure_reason="insufficient_funds",
        policy=policy,
    )
    assert reasons[0] is None
    assert reasons[100] is None
    assert reasons[250] is not None


def test_eligibility_propagates_base_intervention_block_to_every_level() -> None:
    reasons = negotiation_engine.determine_candidate_eligibility(
        levels=[0, 100],
        base_intervention_id="voice_call",
        base_eligible=False,
        base_blocked_reason="Blocked: voice_call requires amount >= Rs.5,000",
        failure_reason="insufficient_funds",
        policy=negotiation_engine.DEFAULT_GUARDRAIL_POLICY,
    )
    assert reasons[0] == "Blocked: voice_call requires amount >= Rs.5,000"
    assert reasons[100] == "Blocked: voice_call requires amount >= Rs.5,000"


# ---------------------------------------------------------------------------
# Candidate computation -- blocked levels never get an EV (docs Section 8)
# ---------------------------------------------------------------------------


def test_compute_candidates_blocked_levels_never_get_an_ev() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100],
        blocked_reasons={0: None, 100: "Blocked: merchant policy does not allow this incentive."},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    blocked = next(c for c in candidates if c.incentive == 100)
    assert blocked.eligible is False
    assert blocked.expected_net_value is None
    assert blocked.recovery_probability is None
    assert blocked.incremental_recovery is None


def test_compute_candidates_eligible_levels_have_full_economics() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100],
        blocked_reasons={0: None, 100: None},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    zero = next(c for c in candidates if c.incentive == 0)
    assert zero.recovery_probability == 0.31
    assert zero.incremental_recovery == 0.0
    assert zero.expected_gross_recovery == pytest.approx(930.0, abs=0.01)
    assert zero.expected_net_value == pytest.approx(927.0, abs=0.01)


# ---------------------------------------------------------------------------
# CRITICAL REGRESSION: the worked scenario proving the central thesis --
# more recovery probability does NOT mean more net value. Every number below
# is computed via the actual functions, not asserted from thin air; see
# docs/RECOVERY_NEGOTIATION_ENGINE.md Section 20 for the derivation.
# ---------------------------------------------------------------------------


def test_worked_3000_insufficient_funds_scenario_three_outcomes_diverge() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100, 250, 500],
        blocked_reasons={0: None, 100: None, 250: None, 500: None},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    by_incentive = {c.incentive: c for c in candidates}

    assert by_incentive[0].expected_net_value == pytest.approx(927.00, abs=0.01)
    assert by_incentive[100].expected_net_value == pytest.approx(1410.33, abs=0.01)
    assert by_incentive[250].expected_net_value == pytest.approx(1472.45, abs=0.01)
    assert by_incentive[500].expected_net_value == pytest.approx(1332.17, abs=0.01)

    max_prob, optimum, mei = negotiation_engine.select_outcomes(candidates, tolerance=0.95)
    assert max_prob == 500
    assert optimum == 250
    assert mei == 100

    max_prob_98, optimum_98, mei_98 = negotiation_engine.select_outcomes(candidates, tolerance=0.98)
    assert max_prob_98 == 500  # tolerance never changes max_recovery_probability_candidate
    assert optimum_98 == 250  # tolerance never changes optimum_candidate
    assert mei_98 == 250

    margin_95 = negotiation_engine.compute_margin_protected(candidates, mei)
    assert margin_95 is None  # next tier (250) has HIGHER value -- correctly omitted, not fabricated

    margin_98 = negotiation_engine.compute_margin_protected(candidates, mei_98)
    assert margin_98 == pytest.approx(140.28, abs=0.01)


def test_margin_protected_none_when_recommendation_is_top_of_ladder() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100],
        blocked_reasons={0: None, 100: None},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    # Force MEI to be the top of a 2-rung ladder -- no "next" tier exists.
    top = max(c.incentive for c in candidates)
    assert negotiation_engine.compute_margin_protected(candidates, top) is None


def test_margin_protected_none_when_no_minimum_effective_intervention() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0],
        blocked_reasons={0: "Blocked: base intervention is not eligible for this payment."},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    assert negotiation_engine.compute_margin_protected(candidates, None) is None


# ---------------------------------------------------------------------------
# select_outcomes edge cases
# ---------------------------------------------------------------------------


def test_select_outcomes_returns_none_when_everything_blocked() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100],
        blocked_reasons={0: "Blocked: x", 100: "Blocked: x"},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    max_prob, optimum, mei = negotiation_engine.select_outcomes(candidates, tolerance=0.95)
    assert (max_prob, optimum, mei) == (None, None, None)


def test_select_outcomes_zero_can_legitimately_win() -> None:
    # bank_timeout has a tiny max_uplift ceiling (0.05) -- any nonzero
    # incentive's linear cost should outweigh it at a modest amount.
    levels = negotiation_engine.generate_incentive_ladder(0, 500, 50)
    candidates = negotiation_engine.compute_candidates(
        levels=levels,
        blocked_reasons={c: None for c in levels},
        base_probability=0.35,
        failure_reason="bank_timeout",
        amount=1500.0,
        intervention_unit_cost=2.0,
    )
    _, optimum, mei = negotiation_engine.select_outcomes(candidates, tolerance=0.95)
    assert optimum == 0
    assert mei == 0


# ---------------------------------------------------------------------------
# build_explanation -- deterministic, no LLM, numbers must appear verbatim
# ---------------------------------------------------------------------------


def test_build_explanation_zero_incentive_case() -> None:
    levels = negotiation_engine.generate_incentive_ladder(0, 500, 50)
    candidates = negotiation_engine.compute_candidates(
        levels=levels,
        blocked_reasons={c: None for c in levels},
        base_probability=0.35,
        failure_reason="bank_timeout",
        amount=1500.0,
        intervention_unit_cost=2.0,
    )
    _, optimum, mei = negotiation_engine.select_outcomes(candidates, tolerance=0.95)
    explanation = negotiation_engine.build_explanation(candidates, optimum, mei, 0.95, negotiation_engine.DEFAULT_GUARDRAIL_POLICY)
    assert "No incentive is recommended" in explanation
    assert "optimal intervention" not in explanation.lower()


def test_build_explanation_interior_case_cites_actual_numbers() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100, 250, 500],
        blocked_reasons={0: None, 100: None, 250: None, 500: None},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    _, optimum, mei = negotiation_engine.select_outcomes(candidates, tolerance=0.95)
    explanation = negotiation_engine.build_explanation(candidates, optimum, mei, 0.95, negotiation_engine.DEFAULT_GUARDRAIL_POLICY)
    assert "100" in explanation
    assert "optimal intervention" not in explanation.lower()


def test_build_explanation_fully_blocked_case() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0],
        blocked_reasons={0: "Blocked: base intervention is not eligible for this payment."},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    explanation = negotiation_engine.build_explanation(candidates, None, None, 0.95, negotiation_engine.DEFAULT_GUARDRAIL_POLICY)
    assert "No incentive level is eligible" in explanation


# ---------------------------------------------------------------------------
# Orchestrator (analyze_negotiation) -- uses a real trained model, mirroring
# test_recovery_lab.py's fixture pattern exactly.
# ---------------------------------------------------------------------------

from app.probability_model import ProbabilityModel
from app.simulator import run_simulation


@pytest.fixture(scope="module")
def bundle():
    return run_simulation(n_customers=150, n_training_logs=4000, n_batch_payments=200, seed=99)


@pytest.fixture(scope="module")
def model(bundle) -> ProbabilityModel:
    m = ProbabilityModel()
    m.fit(bundle.training_logs, bundle.customers, seed=99)
    return m


def _payment_and_customer(bundle, index: int = 0):
    payment = bundle.batch_payments.iloc[index].to_dict()
    customer = bundle.customers[bundle.customers["customer_id"] == payment["customer_id"]].iloc[0].to_dict()
    return payment, customer


def test_analyze_negotiation_reproducible_for_same_input(bundle, model) -> None:
    payment, customer = _payment_and_customer(bundle)
    r1 = negotiation_engine.analyze_negotiation(payment, customer, "sms_link", model, set(), 0)
    r2 = negotiation_engine.analyze_negotiation(payment, customer, "sms_link", model, set(), 0)
    assert r1 == r2


def test_analyze_negotiation_different_payments_can_differ(bundle, model) -> None:
    p1, c1 = _payment_and_customer(bundle, 0)
    p2, c2 = _payment_and_customer(bundle, 1)
    r1 = negotiation_engine.analyze_negotiation(p1, c1, "sms_link", model, set(), 0)
    r2 = negotiation_engine.analyze_negotiation(p2, c2, "sms_link", model, set(), 0)
    assert r1.payment_id != r2.payment_id


def test_analyze_negotiation_suppressed_customer_blocks_every_candidate(bundle, model) -> None:
    payment, customer = _payment_and_customer(bundle)
    result = negotiation_engine.analyze_negotiation(
        payment, customer, "sms_link", model, {payment["customer_id"]}, 0,
    )
    assert all(not c.eligible for c in result.candidates)
    assert result.optimum_candidate is None
    assert result.minimum_effective_intervention is None


def test_analyze_negotiation_rejects_bad_tolerance(bundle, model) -> None:
    payment, customer = _payment_and_customer(bundle)
    with pytest.raises(ValueError):
        negotiation_engine.analyze_negotiation(payment, customer, "sms_link", model, set(), 0, optimization_tolerance=1.5)


def test_analyze_negotiation_never_imports_razorpay_client() -> None:
    # Checks actual import statements, not prose -- the module's own
    # docstring legitimately DISCUSSES this boundary in English ("never
    # imports razorpay_client"), which a naive full-source substring check
    # would misfire on.
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(negotiation_engine))
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names.add(node.module)
            imported_names.update(alias.name for alias in node.names)
    assert not any("razorpay_client" in name for name in imported_names)


# ---------------------------------------------------------------------------
# API-level tests (TestClient), mirroring test_recovery_lab.py /
# test_revenue_autopsy.py conventions exactly.
# ---------------------------------------------------------------------------

from app.main import app


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def _seed_and_get_payment_id(client: TestClient) -> str:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    decisions = client.get("/decisions", params={"page_size": 1}).json()["decisions"]
    return decisions[0]["payment_id"]


def test_analyze_endpoint_returns_three_distinct_outcomes(client: TestClient) -> None:
    payment_id = _seed_and_get_payment_id(client)
    res = client.post("/recovery-negotiation/analyze", json={"payment_id": payment_id})
    assert res.status_code == 200
    body = res.json()
    assert "max_recovery_probability_candidate" in body
    assert "optimum_candidate" in body
    assert "minimum_effective_intervention" in body
    assert body["optimization_tolerance"] == 0.95
    assert "optimal intervention" not in body["explanation"].lower()


def test_analyze_endpoint_unknown_payment_returns_404(client: TestClient) -> None:
    res = client.post("/recovery-negotiation/analyze", json={"payment_id": "does_not_exist"})
    assert res.status_code == 404


def test_analyze_endpoint_rejects_bad_step_via_field_validation(client: TestClient) -> None:
    payment_id = _seed_and_get_payment_id(client)
    res = client.post("/recovery-negotiation/analyze", json={"payment_id": payment_id, "step": 0})
    assert res.status_code == 422


def test_analyze_endpoint_rejects_too_many_candidates(client: TestClient) -> None:
    payment_id = _seed_and_get_payment_id(client)
    res = client.post(
        "/recovery-negotiation/analyze",
        json={"payment_id": payment_id, "min_incentive": 0, "max_incentive": 1_000_000, "step": 1},
    )
    assert res.status_code == 400


def test_analyze_endpoint_never_appends_to_audit_log(client: TestClient) -> None:
    payment_id = _seed_and_get_payment_id(client)
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.post("/recovery-negotiation/analyze", json={"payment_id": payment_id})
    client.post("/recovery-negotiation/analyze", json={"payment_id": payment_id})
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before
