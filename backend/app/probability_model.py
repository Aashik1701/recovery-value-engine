"""Recovery-probability model: P(recovery | context, intervention).

Trained ONLY on ``training_logs`` (a logged randomized trial -- see
simulator.py), using ``observed_outcome`` as the label. Never trains on, or
otherwise touches, the hidden ``_simulator_truth`` table.

Uses scikit-learn's HistGradientBoostingClassifier for native categorical
handling (no manual one-hot encoding needed), explainable feature
importances, and built-in calibration-friendly probability outputs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from app.models import ALL_INTERVENTION_IDS, CalibrationBin, MetricsResponse

CATEGORICAL_FEATURES = ["failure_reason", "transaction_type", "assigned_intervention"]
NUMERIC_FEATURES = ["amount", "retry_count_so_far", "past_success_rate", "ltv"]
FEATURE_COLUMNS = CATEGORICAL_FEATURES + NUMERIC_FEATURES

# Fixed category vocabularies so that a single-row inference frame gets the
# exact same pandas Categorical dtype/categories as the training frame did.
_CATEGORY_VALUES = {
    "failure_reason": [
        "insufficient_funds", "bank_timeout", "network_error",
        "card_expired", "fraud_block", "other",
    ],
    "transaction_type": ["one_time", "subscription"],
    "assigned_intervention": ALL_INTERVENTION_IDS,
}


def _prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    """Cast categorical columns to pandas Categorical with fixed categories."""
    out = df[FEATURE_COLUMNS].copy()
    for col in CATEGORICAL_FEATURES:
        out[col] = pd.Categorical(out[col], categories=_CATEGORY_VALUES[col])
    return out


def _merge_customer_features(payments_df: pd.DataFrame, customers_df: pd.DataFrame) -> pd.DataFrame:
    return payments_df.merge(
        customers_df[["customer_id", "ltv", "past_success_rate"]], on="customer_id", how="left"
    )


@dataclass
class ProbabilityModel:
    model: HistGradientBoostingClassifier = field(default=None)
    auc: float = 0.0
    n_train: int = 0
    n_test: int = 0
    calibration_bins: List[CalibrationBin] = field(default_factory=list)
    _is_fit: bool = False

    def fit(self, training_logs_df: pd.DataFrame, customers_df: pd.DataFrame, seed: int = 42) -> None:
        merged = _merge_customer_features(training_logs_df, customers_df)
        X = _prepare_features(merged)
        y = merged["observed_outcome"].astype(int).to_numpy()

        categorical_mask = [c in CATEGORICAL_FEATURES for c in FEATURE_COLUMNS]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=seed, stratify=y
        )

        self.model = HistGradientBoostingClassifier(
            categorical_features=categorical_mask,
            random_state=seed,
            max_iter=200,
        )
        self.model.fit(X_train, y_train)

        probs = self.model.predict_proba(X_test)[:, 1]
        self.auc = float(roc_auc_score(y_test, probs)) if len(np.unique(y_test)) > 1 else float("nan")
        self.n_train = len(X_train)
        self.n_test = len(X_test)

        frac_pos, mean_pred = calibration_curve(y_test, probs, n_bins=10, strategy="quantile")
        # Recompute per-bin sample counts for reporting (calibration_curve
        # doesn't return them directly).
        bin_edges = np.quantile(probs, np.linspace(0, 1, 11))
        bin_edges[0], bin_edges[-1] = -np.inf, np.inf
        bin_idx = np.digitize(probs, bin_edges[1:-1])
        counts = [int(np.sum(bin_idx == i)) for i in range(len(mean_pred))]

        self.calibration_bins = [
            CalibrationBin(
                mean_predicted_probability=float(mp),
                fraction_of_positives=float(fp),
                n_samples=counts[i] if i < len(counts) else 0,
            )
            for i, (mp, fp) in enumerate(zip(mean_pred, frac_pos))
        ]
        self._is_fit = True

    def get_metrics(self) -> MetricsResponse:
        if not self._is_fit:
            raise RuntimeError("ProbabilityModel has not been fit yet.")
        return MetricsResponse(
            auc=self.auc,
            n_train=self.n_train,
            n_test=self.n_test,
            calibration_bins=self.calibration_bins,
        )

    def predict_proba_for_intervention(
        self, payment: Dict, customer: Dict, intervention_id: str
    ) -> float:
        row = {
            "failure_reason": payment["failure_reason"],
            "transaction_type": payment["transaction_type"],
            "amount": payment["amount"],
            "retry_count_so_far": payment["retry_count_so_far"],
            "past_success_rate": customer["past_success_rate"],
            "ltv": customer["ltv"],
            "assigned_intervention": intervention_id,
        }
        X = _prepare_features(pd.DataFrame([row]))
        return float(self.model.predict_proba(X)[0, 1])

    def predict_proba_matrix(
        self, payment: Dict, customer: Dict, intervention_ids: List[str]
    ) -> Dict[str, float]:
        rows = []
        for intervention_id in intervention_ids:
            rows.append(
                {
                    "failure_reason": payment["failure_reason"],
                    "transaction_type": payment["transaction_type"],
                    "amount": payment["amount"],
                    "retry_count_so_far": payment["retry_count_so_far"],
                    "past_success_rate": customer["past_success_rate"],
                    "ltv": customer["ltv"],
                    "assigned_intervention": intervention_id,
                }
            )
        X = _prepare_features(pd.DataFrame(rows))
        probs = self.model.predict_proba(X)[:, 1]
        return {iid: float(p) for iid, p in zip(intervention_ids, probs)}

    def predict_proba_batch_matrix(
        self, payments_df: pd.DataFrame, customers_df: pd.DataFrame, intervention_ids: List[str]
    ) -> Dict[str, np.ndarray]:
        """Vectorized sibling of ``predict_proba_matrix`` for a whole batch of
        payments at once: one ``predict_proba`` call per intervention across
        every row, instead of one call per (payment, intervention) pair.

        Used by the Recovery Lab digital twin (recovery_lab.py), which needs
        P(recovery | context, intervention) for potentially thousands of
        payments per simulation -- looping the per-payment method that many
        times would be the same computation done far more slowly. Returns a
        dict of intervention_id -> ndarray aligned with ``payments_df``'s
        row order (a left merge preserves left-frame row order in pandas).
        """
        merged = _merge_customer_features(payments_df, customers_df)
        out: Dict[str, np.ndarray] = {}
        for intervention_id in intervention_ids:
            rows = merged.copy()
            rows["assigned_intervention"] = intervention_id
            X = _prepare_features(rows)
            out[intervention_id] = self.model.predict_proba(X)[:, 1]
        return out
