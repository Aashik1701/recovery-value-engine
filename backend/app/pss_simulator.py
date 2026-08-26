"""Synthetic data generation for the Payment Success Score (v2).

Payment Success Score answers a different question than the rest of this
codebase: RVE decides what to do about a payment that has ALREADY failed;
this module estimates, for a payment about to be ATTEMPTED, how likely it
is to succeed on each available payment method, given live conditions
(gateway latency, error rate, traffic load, merchant uptime). See
CLAUDE.md Section 20 for why this exists and what it deliberately does not
claim.

Same discipline as simulator.py, and for the same reason -- a decision that
shapes which payment method gets recommended needs to be reproducible and
auditable, so the causal-uplift-not-correlation design matters here too:

  * ``_pss_simulator_truth``  -- HIDDEN ground truth. Only pss_evaluator.py
                                   is allowed to read this. pss_model.py
                                   must never see it.
  * ``pss_training_logs``     -- a logged randomized trial: the payment
                                   method is assigned UNIFORMLY AT RANDOM
                                   (not by the router) so the model learns
                                   causal P(success | conditions, method)
                                   instead of confounded correlation.
  * a fresh, unseen batch of ``conditions`` draws (no assigned method) for
    the live /pss/score endpoint and offline evaluation to run against.

All data is synthetic. No real transactions, no real PII, and none of the
per-method sensitivity numbers below are sourced from any real payment
provider -- they are hand-picked, documented assumptions, same as
simulator.py's own disclaimer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

PAYMENT_METHODS: List[str] = ["upi", "card", "netbanking", "wallet"]

# Baseline success probability per method under healthy conditions
# (low latency, low error rate, normal traffic, high merchant uptime).
BASE_SUCCESS_PROB_BY_METHOD: Dict[str, float] = {
    "upi": 0.94,
    "card": 0.89,
    "netbanking": 0.82,
    "wallet": 0.86,
}

# How much each method degrades per unit of bad condition. Rationale
# (documented, not measured): UPI is a real-time bank-rail handshake, so
# it's the most latency- and error-sensitive; card auth tolerates longer
# round trips but leans more on the merchant's own gateway config; net
# banking is a bank-redirect flow and degrades broadly under any of the
# four conditions; wallet balance debits are the most self-contained and
# the least sensitive to any single condition, at the cost of a lower
# healthy-state baseline.
SENSITIVITY_BY_METHOD: Dict[str, Dict[str, float]] = {
    "upi": {"latency": 0.35, "error_rate": 2.0, "traffic": 0.12, "uptime": 0.5},
    "card": {"latency": 0.15, "error_rate": 1.2, "traffic": 0.08, "uptime": 0.6},
    "netbanking": {"latency": 0.25, "error_rate": 1.6, "traffic": 0.10, "uptime": 0.7},
    "wallet": {"latency": 0.10, "error_rate": 0.8, "traffic": 0.05, "uptime": 0.3},
}

# Healthy-baseline reference points used to normalize each raw condition
# into a comparable 0..1-ish "badness" scale before applying sensitivity.
HEALTHY_LATENCY_MS = 100.0
BAD_LATENCY_MS = 450.0


def _rand_id(rng: np.random.Generator, n_bytes: int = 6) -> str:
    """Deterministic, rng-derived hex id -- see simulator.py's identical helper."""
    return bytes(rng.integers(0, 256, size=n_bytes, dtype=np.uint8)).hex()


def _sample_amount(rng: np.random.Generator) -> float:
    return float(np.clip(rng.lognormal(mean=7.2, sigma=1.0), 50, 200_000))


def _sample_transaction_type(rng: np.random.Generator) -> str:
    return str(rng.choice(["one_time", "subscription"], p=[0.7, 0.3]))


def sample_conditions_row(rng: np.random.Generator) -> Dict:
    """One draw of live conditions plus the transaction context they apply to."""
    return {
        "gateway_latency_ms": float(np.clip(rng.normal(160, 80), 60, 600)),
        "gateway_error_rate": float(np.clip(rng.beta(1.5, 12), 0.0, 0.4)),
        "traffic_load_index": float(np.clip(rng.normal(1.0, 0.35), 0.3, 2.5)),
        "merchant_uptime_pct": float(np.clip(rng.normal(99.0, 1.2), 90.0, 100.0)),
        "amount": _sample_amount(rng),
        "transaction_type": _sample_transaction_type(rng),
    }


def true_success_prob(method: str, conditions: Dict, rng: np.random.Generator) -> float:
    """Exact synthetic ground-truth P(success | conditions, method).

    Deterministic given (method, conditions, rng draw for noise) -- the
    noise term models transaction-level variance a model can't explain
    from conditions alone (a specific card's issuer bank having a bad
    minute, etc.), same role as simulator.py's per-row noise.
    """
    base = BASE_SUCCESS_PROB_BY_METHOD[method]
    sens = SENSITIVITY_BY_METHOD[method]

    latency_badness = np.clip(
        (conditions["gateway_latency_ms"] - HEALTHY_LATENCY_MS) / (BAD_LATENCY_MS - HEALTHY_LATENCY_MS),
        0.0,
        1.0,
    )
    traffic_badness = max(0.0, conditions["traffic_load_index"] - 1.0)
    uptime_badness = (100.0 - conditions["merchant_uptime_pct"]) / 100.0

    penalty = (
        sens["latency"] * latency_badness
        + sens["error_rate"] * conditions["gateway_error_rate"]
        + sens["traffic"] * traffic_badness
        + sens["uptime"] * uptime_badness
    )
    noise = rng.normal(0, 0.02)
    return float(np.clip(base - penalty + noise, 0.01, 0.995))


# ---------------------------------------------------------------------------
# Training logs: logged randomized trial (random-exploration policy)
# ---------------------------------------------------------------------------


def generate_pss_training_logs(n_logs: int, rng: np.random.Generator) -> pd.DataFrame:
    """Payment method assigned UNIFORMLY AT RANDOM per draw -- never by the
    router -- for the same causal-cleanliness reason as
    simulator.py's generate_training_logs. Hidden ground truth is used only
    to sample the observed outcome and is not a column of the returned frame.
    """
    rows: List[Dict] = []
    assigned_methods = rng.choice(PAYMENT_METHODS, size=n_logs)
    for i in range(n_logs):
        row = sample_conditions_row(rng)
        method = str(assigned_methods[i])
        true_prob = true_success_prob(method, row, rng)
        row["payment_method"] = method
        row["observed_outcome"] = int(rng.random() < true_prob)
        rows.append(row)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Held-out batch + hidden truth, for pss_evaluator.py only
# ---------------------------------------------------------------------------


def generate_pss_batch(n: int, rng: np.random.Generator) -> pd.DataFrame:
    """A fresh, unseen batch of condition draws, no assigned method."""
    rows = [{"scenario_id": f"pss_{_rand_id(rng)}", **sample_conditions_row(rng)} for _ in range(n)]
    return pd.DataFrame(rows)


def generate_pss_hidden_truth(batch_df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """HIDDEN ground truth for a batch of scenarios. Only pss_evaluator.py
    may read this: true P(success) per method for every scenario."""
    rows = []
    for _, scenario in batch_df.iterrows():
        conditions = scenario.to_dict()
        true_probs = {m: true_success_prob(m, conditions, rng) for m in PAYMENT_METHODS}
        rows.append({"scenario_id": scenario["scenario_id"], "true_success_prob": true_probs})
    return pd.DataFrame(rows)


@dataclass
class PSSSimulationBundle:
    seed: int
    training_logs: pd.DataFrame
    batch: pd.DataFrame
    hidden_truth: pd.DataFrame


def run_pss_simulation(
    n_training_logs: int = 20000,
    n_batch: int = 300,
    seed: int = 42,
) -> PSSSimulationBundle:
    rng = np.random.default_rng(seed)
    training_logs = generate_pss_training_logs(n_training_logs, rng)
    batch = generate_pss_batch(n_batch, rng)
    hidden_truth = generate_pss_hidden_truth(batch, rng)
    return PSSSimulationBundle(seed=seed, training_logs=training_logs, batch=batch, hidden_truth=hidden_truth)
