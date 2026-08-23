import numpy as np

from app.models import ALL_INTERVENTION_IDS
from app.simulator import (
    generate_customers,
    generate_failed_payments,
    generate_hidden_truth,
    generate_training_logs,
    run_simulation,
)


def test_generate_customers_shape_and_columns() -> None:
    rng = np.random.default_rng(1)
    customers = generate_customers(50, rng)
    assert len(customers) == 50
    assert set(customers["customer_id"]).__len__() == 50  # all unique
    for col in ["customer_id", "ltv", "past_success_rate", "preferred_channel"]:
        assert col in customers.columns


def test_training_logs_contains_random_assignment_and_outcome() -> None:
    rng = np.random.default_rng(2)
    customers = generate_customers(20, rng)
    logs = generate_training_logs(200, customers, rng)
    assert len(logs) == 200
    assert set(logs["assigned_intervention"].unique()).issubset(set(ALL_INTERVENTION_IDS))
    assert set(logs["observed_outcome"].unique()).issubset({0, 1})
    # hidden truth columns must NOT leak into training_logs
    assert "base_recovery_prob" not in logs.columns
    assert "uplift_by_intervention" not in logs.columns


def test_hidden_truth_has_expected_shape() -> None:
    rng = np.random.default_rng(3)
    customers = generate_customers(20, rng)
    payments = generate_failed_payments(30, customers, rng)
    truth = generate_hidden_truth(payments, rng)
    assert len(truth) == 30
    assert set(truth["payment_id"]) == set(payments["payment_id"])
    for uplift_dict in truth["uplift_by_intervention"]:
        assert set(uplift_dict.keys()) == set(ALL_INTERVENTION_IDS)
    assert (truth["base_recovery_prob"] >= 0).all() and (truth["base_recovery_prob"] <= 1).all()


def test_run_simulation_is_reproducible_with_same_seed() -> None:
    bundle_a = run_simulation(n_customers=10, n_training_logs=50, n_batch_payments=5, seed=123)
    bundle_b = run_simulation(n_customers=10, n_training_logs=50, n_batch_payments=5, seed=123)
    assert bundle_a.customers["ltv"].tolist() == bundle_b.customers["ltv"].tolist()
    assert bundle_a.training_logs["observed_outcome"].tolist() == bundle_b.training_logs["observed_outcome"].tolist()


def test_run_simulation_batch_payments_have_no_assigned_intervention() -> None:
    bundle = run_simulation(n_customers=10, n_training_logs=20, n_batch_payments=5, seed=7)
    assert "assigned_intervention" not in bundle.batch_payments.columns
    assert "observed_outcome" not in bundle.batch_payments.columns
