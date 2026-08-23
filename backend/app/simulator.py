"""Synthetic data generation for the Recovery Value Engine.

Generates, with a fixed random seed for reproducibility:
  * ``customers``            -- customer context features
  * ``_simulator_truth``     -- HIDDEN ground truth. Only evaluator.py is
                                 allowed to read this. The probability model
                                 and optimizer must never see it.
  * ``training_logs``        -- a logged randomized trial: intervention is
                                 assigned UNIFORMLY AT RANDOM (not by any
                                 policy) so the probability model can learn
                                 causal uplift instead of confounded
                                 correlation.
  * a fresh, unseen batch of ``failed_payments`` (no assigned intervention)
    for the live decision pipeline / offline evaluation to run against.

All data is synthetic. No real transactions, no real PII.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List

import numpy as np
import pandas as pd

from app.models import ALL_INTERVENTION_IDS, FailureReason, PreferredChannel, TransactionType

# ---------------------------------------------------------------------------
# Distributions used to generate plausible-looking synthetic data.
# These are hand-picked, documented assumptions -- not fitted to any real
# data (there is none). They exist to give the simulator internal structure
# (e.g. bank_timeout implies higher organic recovery than fraud_block) so
# that a model trained on it has something non-trivial to learn.
# ---------------------------------------------------------------------------

FAILURE_REASON_WEIGHTS: Dict[str, float] = {
    FailureReason.INSUFFICIENT_FUNDS.value: 0.30,
    FailureReason.BANK_TIMEOUT.value: 0.20,
    FailureReason.NETWORK_ERROR.value: 0.15,
    FailureReason.CARD_EXPIRED.value: 0.15,
    FailureReason.FRAUD_BLOCK.value: 0.05,
    FailureReason.OTHER.value: 0.15,
}

# Baseline organic (no-intervention) recovery probability by failure reason.
# bank_timeout / network_error are transient -> customer likely to succeed on
# their own; fraud_block is close to unrecoverable; card_expired is a channel
# problem, not an intent problem, so a middling organic baseline.
BASE_RECOVERY_PROB_BY_REASON: Dict[str, float] = {
    FailureReason.INSUFFICIENT_FUNDS.value: 0.15,
    FailureReason.BANK_TIMEOUT.value: 0.35,
    FailureReason.NETWORK_ERROR.value: 0.30,
    FailureReason.CARD_EXPIRED.value: 0.10,
    FailureReason.FRAUD_BLOCK.value: 0.02,
    FailureReason.OTHER.value: 0.18,
}

# Additive uplift per intervention, by failure reason. This is the causal
# effect an intervention has on top of the base organic recovery probability.
# Chosen to reflect the intuitions documented in AGENTS.md Section 4 (e.g.
# retry_now works well for transient failures, retry_later for timing
# problems, voice_call is the highest-uplift-but-highest-cost channel).
UPLIFT_BY_REASON_AND_INTERVENTION: Dict[str, Dict[str, float]] = {
    FailureReason.INSUFFICIENT_FUNDS.value: {
        "no_action": 0.0, "retry_now": 0.03, "retry_later": 0.15, "sms_link": 0.08,
        "whatsapp_nudge": 0.10, "email": 0.04, "voice_call": 0.18,
    },
    FailureReason.BANK_TIMEOUT.value: {
        "no_action": 0.0, "retry_now": 0.25, "retry_later": 0.10, "sms_link": 0.05,
        "whatsapp_nudge": 0.06, "email": 0.02, "voice_call": 0.12,
    },
    FailureReason.NETWORK_ERROR.value: {
        "no_action": 0.0, "retry_now": 0.22, "retry_later": 0.09, "sms_link": 0.05,
        "whatsapp_nudge": 0.06, "email": 0.02, "voice_call": 0.10,
    },
    FailureReason.CARD_EXPIRED.value: {
        "no_action": 0.0, "retry_now": 0.01, "retry_later": 0.02, "sms_link": 0.12,
        "whatsapp_nudge": 0.15, "email": 0.06, "voice_call": 0.20,
    },
    FailureReason.FRAUD_BLOCK.value: {
        "no_action": 0.0, "retry_now": 0.0, "retry_later": 0.0, "sms_link": 0.01,
        "whatsapp_nudge": 0.01, "email": 0.01, "voice_call": 0.02,
    },
    FailureReason.OTHER.value: {
        "no_action": 0.0, "retry_now": 0.05, "retry_later": 0.05, "sms_link": 0.07,
        "whatsapp_nudge": 0.08, "email": 0.04, "voice_call": 0.10,
    },
}

# Higher-value payments engage more with higher-touch channels (whatsapp,
# voice); this is what makes uplift "vary ... by amount band" per the spec.
AMOUNT_BAND_MULTIPLIER = {
    "low": {"voice_call": 1.0, "whatsapp_nudge": 1.0},
    "mid": {"voice_call": 1.15, "whatsapp_nudge": 1.1},
    "high": {"voice_call": 1.4, "whatsapp_nudge": 1.2},
}


def _rand_id(rng: np.random.Generator, n_bytes: int = 6) -> str:
    """Deterministic, rng-derived hex id.

    Deliberately NOT uuid.uuid4() -- that draws from OS entropy and would
    silently break reproducibility (same seed, different ids) even though
    every other value in the simulation is drawn from the seeded rng.
    """
    return bytes(rng.integers(0, 256, size=n_bytes, dtype=np.uint8)).hex()


def _amount_band(amount: float) -> str:
    if amount < 1000:
        return "low"
    if amount < 5000:
        return "mid"
    return "high"


def _sample_amount(rng: np.random.Generator) -> float:
    # Lognormal gives a realistic right-skewed spend distribution.
    return float(np.clip(rng.lognormal(mean=7.2, sigma=1.0), 50, 200_000))


def _sample_failure_reason(rng: np.random.Generator) -> str:
    reasons = list(FAILURE_REASON_WEIGHTS.keys())
    weights = list(FAILURE_REASON_WEIGHTS.values())
    return str(rng.choice(reasons, p=weights))


def _sample_retry_count(rng: np.random.Generator) -> int:
    return int(rng.choice([0, 1, 2, 3], p=[0.55, 0.25, 0.13, 0.07]))


def _uplift_for_payment(failure_reason: str, amount: float, rng: np.random.Generator) -> Dict[str, float]:
    band = _amount_band(amount)
    multipliers = AMOUNT_BAND_MULTIPLIER[band]
    base = UPLIFT_BY_REASON_AND_INTERVENTION[failure_reason]
    uplift: Dict[str, float] = {}
    for intervention_id, base_uplift in base.items():
        mult = multipliers.get(intervention_id, 1.0)
        noise = rng.normal(0, 0.015)
        uplift[intervention_id] = max(0.0, base_uplift * mult + noise)
    return uplift


def _base_recovery_prob_for_payment(
    failure_reason: str, retry_count_so_far: int, rng: np.random.Generator
) -> float:
    base = BASE_RECOVERY_PROB_BY_REASON[failure_reason]
    # Repeated organic retries without intervention show diminishing returns
    # (customer fatigue / the easy organic recoveries already happened).
    fatigue = 0.03 * retry_count_so_far
    noise = rng.normal(0, 0.02)
    return float(np.clip(base - fatigue + noise, 0.0, 1.0))


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


def generate_customers(n_customers: int, rng: np.random.Generator) -> pd.DataFrame:
    channels = list(PreferredChannel)
    channel_weights = [0.25, 0.20, 0.20, 0.10, 0.25]  # sms, whatsapp, email, voice, none
    rows = []
    for _ in range(n_customers):
        rows.append(
            {
                "customer_id": f"cust_{_rand_id(rng)}",
                "ltv": float(np.clip(rng.lognormal(mean=8.5, sigma=1.1), 500, 5_000_000)),
                "past_success_rate": float(np.clip(rng.beta(5, 2), 0.0, 1.0)),
                "preferred_channel": rng.choice([c.value for c in channels], p=channel_weights),
            }
        )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Failed payments (context only -- no assigned intervention, no hidden truth)
# ---------------------------------------------------------------------------


def _generate_payment_rows(
    n: int, customer_ids: List[str], rng: np.random.Generator, id_prefix: str, base_time: datetime
) -> pd.DataFrame:
    rows = []
    for _ in range(n):
        failure_reason = _sample_failure_reason(rng)
        amount = _sample_amount(rng)
        retry_count = _sample_retry_count(rng)
        txn_type = rng.choice([t.value for t in TransactionType], p=[0.7, 0.3])
        offset_minutes = int(rng.integers(0, 60 * 24 * 14))
        rows.append(
            {
                "payment_id": f"{id_prefix}_{_rand_id(rng)}",
                "customer_id": rng.choice(customer_ids),
                "amount": amount,
                "failure_reason": failure_reason,
                "transaction_type": txn_type,
                "failed_at": base_time - timedelta(minutes=offset_minutes),
                "retry_count_so_far": retry_count,
            }
        )
    return pd.DataFrame(rows)


def generate_failed_payments(
    n: int, customers_df: pd.DataFrame, rng: np.random.Generator, id_prefix: str = "pay"
) -> pd.DataFrame:
    """A fresh, unseen batch of failed payments with no assigned intervention."""
    return _generate_payment_rows(n, customers_df["customer_id"].tolist(), rng, id_prefix, datetime.utcnow())


def generate_hidden_truth(failed_payments_df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """HIDDEN ground truth for a batch of failed payments.

    Only evaluator.py may read this. base_recovery_prob is the probability
    of organic recovery with no intervention; uplift_by_intervention is the
    additive per-intervention uplift on top of that base probability.
    """
    rows = []
    for _, payment in failed_payments_df.iterrows():
        base_prob = _base_recovery_prob_for_payment(
            payment["failure_reason"], int(payment["retry_count_so_far"]), rng
        )
        uplift = _uplift_for_payment(payment["failure_reason"], float(payment["amount"]), rng)
        rows.append(
            {
                "payment_id": payment["payment_id"],
                "base_recovery_prob": base_prob,
                "uplift_by_intervention": uplift,
            }
        )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Training logs: logged randomized trial (random-exploration policy)
# ---------------------------------------------------------------------------


def generate_training_logs(
    n_logs: int, customers_df: pd.DataFrame, rng: np.random.Generator
) -> pd.DataFrame:
    """Generate training_logs via a random-exploration policy.

    Interventions are assigned UNIFORMLY AT RANDOM -- never by the optimizer
    or any heuristic -- which is what lets the probability model learn
    causal P(recovery | context, intervention) instead of a confounded
    correlation between "who got contacted" and "who was already likely to
    pay". Hidden ground truth is used only to sample the observed outcome
    and is then discarded -- it is NOT a column of the returned frame.
    """
    payments_df = _generate_payment_rows(
        n_logs, customers_df["customer_id"].tolist(), rng, "train", datetime.utcnow()
    )

    assigned_interventions = rng.choice(ALL_INTERVENTION_IDS, size=n_logs)

    observed_outcomes = np.empty(n_logs, dtype=int)
    for i, payment in payments_df.iterrows():
        base_prob = _base_recovery_prob_for_payment(
            payment["failure_reason"], int(payment["retry_count_so_far"]), rng
        )
        uplift = _uplift_for_payment(payment["failure_reason"], float(payment["amount"]), rng)
        assigned = assigned_interventions[i]
        noise = rng.normal(0, 0.03)
        true_prob = float(np.clip(base_prob + uplift[assigned] + noise, 0.0, 1.0))
        observed_outcomes[i] = int(rng.random() < true_prob)

    payments_df["assigned_intervention"] = assigned_interventions
    payments_df["observed_outcome"] = observed_outcomes
    return payments_df


# ---------------------------------------------------------------------------
# Top-level bundle
# ---------------------------------------------------------------------------


@dataclass
class SimulationBundle:
    seed: int
    customers: pd.DataFrame
    training_logs: pd.DataFrame
    batch_payments: pd.DataFrame
    hidden_truth: pd.DataFrame  # keyed by payment_id, for batch_payments only


def run_simulation(
    n_customers: int = 2000,
    n_training_logs: int = 30000,
    n_batch_payments: int = 500,
    seed: int = 42,
) -> SimulationBundle:
    rng = np.random.default_rng(seed)
    customers = generate_customers(n_customers, rng)
    training_logs = generate_training_logs(n_training_logs, customers, rng)
    batch_payments = generate_failed_payments(n_batch_payments, customers, rng, id_prefix="pay")
    hidden_truth = generate_hidden_truth(batch_payments, rng)
    return SimulationBundle(
        seed=seed,
        customers=customers,
        training_logs=training_logs,
        batch_payments=batch_payments,
        hidden_truth=hidden_truth,
    )
