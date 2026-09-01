"""Shared fixtures.

The default-startup bundle + trained model (with the bootstrap confidence
ensemble) is expensive to build -- 30k training logs, 20 ensemble members,
~90s. Both test_recovery_lab.py's pinned-numbers test and
test_confidence_escalation.py's end-to-end escalation test need exactly this
model, so it is built ONCE per session here rather than once per file.
"""

from __future__ import annotations

import os

# Keep the FastAPI app's on_startup simulation fast: skip the 20-member
# confidence ensemble there (each TestClient app-startup would otherwise pay
# ~60-90s). /decide degrades to no-confidence-data in that mode; the
# escalation path is exercised directly, with a real ensemble, in
# test_confidence_escalation.py via the default_startup_model fixture below.
os.environ.setdefault("RVE_FAST_STARTUP", "1")

import pytest

from app.probability_model import ProbabilityModel
from app.simulator import run_simulation


@pytest.fixture(scope="session")
def default_startup_bundle():
    # Exactly SimulateRequest()'s defaults -> what _seed_initial_simulation
    # runs on startup. Must not be shrunk: the pinned numbers and the
    # escalation threshold are both a function of this dataset size + seed.
    return run_simulation(n_customers=2000, n_training_logs=30000, n_batch_payments=500, seed=42)


@pytest.fixture(scope="session")
def default_startup_model(default_startup_bundle) -> ProbabilityModel:
    m = ProbabilityModel()
    m.fit(default_startup_bundle.training_logs, default_startup_bundle.customers, seed=42)  # train_ensemble=True
    return m
