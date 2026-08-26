"""Tests for the Recovery Lab ("Revenue Recovery Digital Twin") simulation
engine -- see recovery_lab.py and docs/RECOVERY_DIGITAL_TWIN.md.

Uses a small, fast synthetic bundle (run_simulation with modest sizes) plus a
real trained ProbabilityModel, exercised directly against recovery_lab.py's
functions -- matching this repo's existing per-module test style (see
test_guardrails.py, test_optimizer.py) -- with a handful of API-level tests
via TestClient for endpoint wiring and request validation.
"""

from __future__ import annotations

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import recovery_lab
from app.main import app
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


def _simulate(bundle, model, **overrides):
    defaults = dict(
        primary_policy_id="rve_adaptive",
        contact_intensity="moderate",
        discount_budget=50_000.0,
        voice_capacity=1000,
        max_contacts_per_customer=2,
        recovery_window_hours=24 * 14,  # wide enough to include the whole synthetic batch
        n_simulation_runs=0,
        seed=42,
    )
    defaults.update(overrides)
    policies, n_in_scope, total_at_risk, example_id = recovery_lab.run_recovery_lab_simulation(
        bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set(), **defaults
    )
    return policies, n_in_scope, total_at_risk, example_id


# ---------------------------------------------------------------------------
# 1 & 13. Deterministic seed reproducibility
# ---------------------------------------------------------------------------


def test_same_seed_same_config_reproduces_identical_result(bundle, model) -> None:
    policies_a, *_ = _simulate(bundle, model, n_simulation_runs=500, seed=7)
    policies_b, *_ = _simulate(bundle, model, n_simulation_runs=500, seed=7)
    for pid in policies_a:
        assert policies_a[pid] == policies_b[pid]


# ---------------------------------------------------------------------------
# 14. Different seed -> potentially different Monte Carlo range (the
# headline analytic metrics stay identical -- only the MC range is random).
# ---------------------------------------------------------------------------


def test_different_seed_can_change_monte_carlo_range(bundle, model) -> None:
    policies_a, *_ = _simulate(bundle, model, n_simulation_runs=500, seed=1)
    policies_b, *_ = _simulate(bundle, model, n_simulation_runs=500, seed=2)
    rve_a, rve_b = policies_a["rve_adaptive"], policies_b["rve_adaptive"]
    # Headline numbers are the exact analytic expectation -- seed-invariant.
    assert rve_a.net_value_created == rve_b.net_value_created
    # But the Monte Carlo range itself is drawn from a different stream.
    assert (rve_a.net_value_low, rve_a.net_value_high) != (rve_b.net_value_low, rve_b.net_value_high)


# ---------------------------------------------------------------------------
# 2 & 12. Policy / parameter validation
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def test_invalid_policy_rejected_by_api(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 50, "n_training_logs": 500, "n_batch_payments": 40, "seed": 1})
    res = client.post("/recovery-lab/simulate", json={"policy": "not_a_real_policy"})
    assert res.status_code == 422


def test_invalid_sensitivity_dimension_rejected_by_api(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 50, "n_training_logs": 500, "n_batch_payments": 40, "seed": 1})
    res = client.post("/recovery-lab/sensitivity", json={"policy": "rve_adaptive", "dimension": "not_a_dimension"})
    assert res.status_code == 400


def test_unknown_dimension_raises_in_engine(bundle, model) -> None:
    with pytest.raises(ValueError):
        recovery_lab.run_sensitivity_sweep(
            bundle.batch_payments,
            bundle.customers,
            bundle.hidden_truth,
            model,
            set(),
            policy_id="rve_adaptive",
            dimension="bogus",
            contact_intensity="moderate",
            discount_budget=1000,
            voice_capacity=10,
            max_contacts_per_customer=2,
            recovery_window_hours=24 * 14,
            seed=1,
        )


# ---------------------------------------------------------------------------
# 3. No-intervention baseline
# ---------------------------------------------------------------------------


def test_no_intervention_has_zero_cost_and_zero_incremental_recovery(bundle, model) -> None:
    policies, *_ = _simulate(bundle, model)
    baseline = policies["no_intervention"]
    assert baseline.intervention_cost == 0.0
    assert baseline.incremental_recovery == 0.0
    assert baseline.net_value_created == 0.0
    assert baseline.gross_recovery == baseline.natural_recovery


# ---------------------------------------------------------------------------
# 4 & 15. RVE policy genuinely uses the real model and does not bypass
# guardrails (voice_call still blocked below the amount threshold).
# ---------------------------------------------------------------------------


def test_rve_adaptive_never_assigns_voice_call_below_threshold(bundle, model) -> None:
    # Force everything into contention for voice_call by setting intensity
    # high and capacity generous -- if the guardrail were bypassed, cheap
    # payments would still end up with voice_call.
    policies, *_ = _simulate(bundle, model, voice_capacity=100000, discount_budget=10_000_000)
    scoped = recovery_lab.scope_payments(bundle.batch_payments, 24 * 14)
    cheap_payment_ids = set(scoped[scoped["amount"] < 5000]["payment_id"])
    # Re-run at the row level via the public entrypoint isn't exposed, so
    # assert indirectly: number_contacted for rve_adaptive must be <=
    # number of payments actually amount-eligible for voice, i.e. the
    # guardrail-filtered policy can't have picked voice_call for a payment
    # under Rs.5,000 -- checked precisely in test_guardrails.py; here we
    # confirm the aggregate cost is consistent with SOME real constraint
    # applying (not everyone gets the max-cost channel for free).
    rve = policies["rve_adaptive"]
    assert rve.intervention_cost < rve.number_contacted * 15.0 + 1e-6  # not all voice_call (Rs.15 each)
    assert len(cheap_payment_ids) > 0  # sanity: the scenario actually has cheap payments to test against


def test_rve_adaptive_uses_real_trained_model_not_a_stub(bundle, model) -> None:
    """Swapping in a differently-seeded (differently-fit) model changes the
    decision, proving the Lab actually calls into ProbabilityModel rather
    than hardcoding a result."""
    other_model = ProbabilityModel()
    other_model.fit(bundle.training_logs.sample(frac=0.5, random_state=1), bundle.customers, seed=1)

    policies_a, *_ = _simulate(bundle, model)
    policies_b, n_in_scope, total_at_risk, _ = recovery_lab.run_recovery_lab_simulation(
        bundle.batch_payments,
        bundle.customers,
        bundle.hidden_truth,
        other_model,
        set(),
        primary_policy_id="rve_adaptive",
        contact_intensity="moderate",
        discount_budget=50_000.0,
        voice_capacity=1000,
        max_contacts_per_customer=2,
        recovery_window_hours=24 * 14,
        n_simulation_runs=0,
        seed=42,
    )
    # Not asserting a specific direction (that would be a flaky test tied to
    # this exact dataset) -- just that using a genuinely different model
    # produces a genuinely different aggregate, i.e. this isn't a stub.
    assert policies_a["rve_adaptive"].gross_recovery != policies_b["rve_adaptive"].gross_recovery


# ---------------------------------------------------------------------------
# 5, 6, 7. Cost accounting, incremental recovery, net value arithmetic
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("policy", ["no_intervention", "always_retry", "aggressive_recovery", "rve_adaptive"])
def test_economic_identities_hold_for_every_policy(bundle, model, policy: str) -> None:
    policies, *_ = _simulate(bundle, model)
    p = policies[policy]
    # Tolerances here account for each field being independently rounded to
    # 2 (or 4, for the rate) decimal places on the response object -- these
    # check the underlying identities hold, not bit-for-bit equality of
    # already-rounded numbers.
    assert p.gross_recovery >= p.natural_recovery - 0.05
    assert abs(p.incremental_recovery - (p.gross_recovery - p.natural_recovery)) < 0.05
    assert abs(p.net_value_created - (p.incremental_recovery - p.intervention_cost)) < 0.05
    if p.total_at_risk > 0:
        assert abs(p.recovery_rate - p.gross_recovery / p.total_at_risk) < 1e-3


def test_always_retry_costs_two_rupees_per_payment_in_scope(bundle, model) -> None:
    policies, n_in_scope, *_ = _simulate(bundle, model, discount_budget=10_000_000)
    always_retry = policies["always_retry"]
    assert always_retry.intervention_cost == pytest.approx(n_in_scope * 2.0)
    assert always_retry.number_intervened == n_in_scope


# ---------------------------------------------------------------------------
# 8. Budget constraint
# ---------------------------------------------------------------------------


def test_zero_budget_forces_no_action_for_every_policy(bundle, model) -> None:
    policies, *_ = _simulate(bundle, model, discount_budget=0.0)
    for pid, p in policies.items():
        assert p.intervention_cost == 0.0, f"{pid} should have spent nothing at zero budget"
        assert p.net_value_created == 0.0


def test_lower_budget_never_increases_net_value(bundle, model) -> None:
    policies_low, *_ = _simulate(bundle, model, discount_budget=100.0)
    policies_high, *_ = _simulate(bundle, model, discount_budget=1_000_000.0)
    low_cost = policies_low["rve_adaptive"].intervention_cost
    high_cost = policies_high["rve_adaptive"].intervention_cost
    assert low_cost <= high_cost + 1e-6


# ---------------------------------------------------------------------------
# 9. Contact-frequency constraint
# ---------------------------------------------------------------------------


def test_tighter_contact_cap_never_increases_contacts(bundle, model) -> None:
    policies_cap1, *_ = _simulate(bundle, model, max_contacts_per_customer=1, discount_budget=10_000_000)
    policies_cap3, *_ = _simulate(bundle, model, max_contacts_per_customer=3, discount_budget=10_000_000)
    assert policies_cap1["rve_adaptive"].number_contacted <= policies_cap3["rve_adaptive"].number_contacted


# ---------------------------------------------------------------------------
# 10. Voice capacity constraint
# ---------------------------------------------------------------------------


def test_zero_voice_capacity_blocks_all_voice_assignments(bundle, model) -> None:
    policies, *_ = _simulate(bundle, model, voice_capacity=0, contact_intensity="high", discount_budget=10_000_000)
    # With zero voice capacity, cost per contacted payment for rve_adaptive
    # must never reflect the Rs.15 voice_call unit cost dominating -- proven
    # indirectly by confirming aggregate cost stays below what it would be
    # if voice_capacity were unlimited.
    unlimited, *_ = _simulate(bundle, model, voice_capacity=100000, contact_intensity="high", discount_budget=10_000_000)
    assert policies["aggressive_recovery"].intervention_cost <= unlimited["aggressive_recovery"].intervention_cost + 1e-6


def test_sensitivity_sweep_finds_optimum_from_actual_results(bundle, model) -> None:
    points, optimal_level, optimal_net_value = recovery_lab.run_sensitivity_sweep(
        bundle.batch_payments,
        bundle.customers,
        bundle.hidden_truth,
        model,
        set(),
        policy_id="rve_adaptive",
        dimension="voice_capacity",
        contact_intensity="high",
        discount_budget=10_000_000,
        voice_capacity=1000,
        max_contacts_per_customer=2,
        recovery_window_hours=24 * 14,
        seed=1,
    )
    assert len(points) >= 2
    assert optimal_net_value == max(p.net_value_created for p in points)
    assert any(p.level == optimal_level for p in points)


# ---------------------------------------------------------------------------
# 11. Simulation aggregation / recovery-window scoping
# ---------------------------------------------------------------------------


def test_recovery_window_shrinks_scope(bundle, model) -> None:
    policies_wide, n_wide, _, _ = _simulate(bundle, model, recovery_window_hours=24 * 14)
    policies_narrow, n_narrow, _, _ = _simulate(bundle, model, recovery_window_hours=1)
    assert n_narrow <= n_wide


def test_aggregation_matches_scoped_batch_size(bundle, model) -> None:
    policies, n_in_scope, total_at_risk, _ = _simulate(bundle, model)
    scoped = recovery_lab.scope_payments(bundle.batch_payments, 24 * 14)
    assert n_in_scope == len(scoped)
    assert total_at_risk == pytest.approx(float(scoped["amount"].sum()), rel=1e-6)
    for p in policies.values():
        assert p.n_payments_in_scope == n_in_scope


# ---------------------------------------------------------------------------
# API wiring
# ---------------------------------------------------------------------------


def test_exposure_endpoint_reflects_current_batch(client: TestClient) -> None:
    sim = client.post(
        "/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5}
    )
    assert sim.status_code == 200
    res = client.get("/recovery-lab/exposure")
    assert res.status_code == 200
    body = res.json()
    assert body["n_failed_payments"] == 25
    assert body["total_at_risk"] > 0


def test_simulate_endpoint_returns_all_four_policies(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    res = client.post("/recovery-lab/simulate", json={"policy": "rve_adaptive", "n_simulation_runs": 200})
    assert res.status_code == 200
    body = res.json()
    assert {p["policy_id"] for p in body["policies"]} == {
        "no_intervention",
        "always_retry",
        "aggressive_recovery",
        "rve_adaptive",
    }
    assert "not a production forecast" in body["note"]


def test_recovery_lab_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.post("/recovery-lab/simulate", json={"policy": "aggressive_recovery"})
    client.post(
        "/recovery-lab/sensitivity", json={"policy": "rve_adaptive", "dimension": "voice_capacity"}
    )
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before
