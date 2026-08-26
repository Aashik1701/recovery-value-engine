import numpy as np

from app.pss_evaluator import run_pss_policy_comparison
from app.pss_model import PSSModel
from app.pss_scorer import score_methods
from app.pss_simulator import (
    PAYMENT_METHODS,
    generate_pss_batch,
    generate_pss_hidden_truth,
    generate_pss_training_logs,
    run_pss_simulation,
)


def test_training_logs_contain_random_assignment_and_outcome() -> None:
    rng = np.random.default_rng(1)
    logs = generate_pss_training_logs(300, rng)
    assert len(logs) == 300
    assert set(logs["payment_method"].unique()).issubset(set(PAYMENT_METHODS))
    assert set(logs["observed_outcome"].unique()).issubset({0, 1})
    # hidden ground truth must NOT leak into training_logs
    assert "true_success_prob" not in logs.columns


def test_hidden_truth_has_one_probability_per_method() -> None:
    rng = np.random.default_rng(2)
    batch = generate_pss_batch(20, rng)
    truth = generate_pss_hidden_truth(batch, rng)
    assert len(truth) == 20
    for probs in truth["true_success_prob"]:
        assert set(probs.keys()) == set(PAYMENT_METHODS)
        assert all(0.0 <= p <= 1.0 for p in probs.values())


def test_run_pss_simulation_is_reproducible_with_same_seed() -> None:
    a = run_pss_simulation(n_training_logs=200, n_batch=10, seed=123)
    b = run_pss_simulation(n_training_logs=200, n_batch=10, seed=123)
    assert a.training_logs["observed_outcome"].tolist() == b.training_logs["observed_outcome"].tolist()


def _trained_model(seed: int = 42) -> PSSModel:
    bundle = run_pss_simulation(n_training_logs=8000, n_batch=200, seed=seed)
    model = PSSModel()
    model.fit(bundle.training_logs, seed=seed)
    return model, bundle


def test_score_methods_ranks_all_methods_and_flags_one_recommended() -> None:
    model, _ = _trained_model()
    healthy = {
        "gateway_latency_ms": 100.0,
        "gateway_error_rate": 0.01,
        "traffic_load_index": 1.0,
        "merchant_uptime_pct": 99.8,
        "amount": 1999.0,
        "transaction_type": "one_time",
    }
    result = score_methods(model, healthy)
    assert {m.method for m in result.methods} == set(PAYMENT_METHODS)
    assert sum(m.recommended for m in result.methods) == 1
    assert result.methods[0].recommended is True
    # sorted descending by success_probability
    probs = [m.success_probability for m in result.methods]
    assert probs == sorted(probs, reverse=True)


def test_degrading_conditions_lowers_the_recommended_methods_score() -> None:
    model, _ = _trained_model()
    healthy = {
        "gateway_latency_ms": 100.0,
        "gateway_error_rate": 0.01,
        "traffic_load_index": 1.0,
        "merchant_uptime_pct": 99.8,
        "amount": 1999.0,
        "transaction_type": "one_time",
    }
    degraded = {
        **healthy,
        "gateway_latency_ms": 450.0,
        "gateway_error_rate": 0.25,
        "traffic_load_index": 2.2,
        "merchant_uptime_pct": 92.0,
    }
    healthy_result = score_methods(model, healthy)
    degraded_result = score_methods(model, degraded)

    healthy_top_score = next(m.score for m in healthy_result.methods if m.recommended)
    degraded_top_score = next(m.score for m in degraded_result.methods if m.recommended)
    assert degraded_top_score < healthy_top_score
    assert degraded_result.delta_from_healthy < 0


def test_evaluator_model_beats_always_upi_baseline() -> None:
    model, bundle = _trained_model(seed=7)
    results = run_pss_policy_comparison(bundle.batch, bundle.hidden_truth, model)
    by_name = {r.policy_name: r for r in results}
    assert by_name["success_score_model"].mean_true_success_prob >= by_name["always_upi"].mean_true_success_prob
