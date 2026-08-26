"""Payment-success model: P(success | conditions, payment_method).

Trained ONLY on ``pss_training_logs`` (a logged randomized trial -- see
pss_simulator.py), using ``observed_outcome`` as the label. Never trains on,
or otherwise touches, the hidden ``_pss_simulator_truth`` table.

Same model family and reasoning as probability_model.py: HistGradientBoostingClassifier
for native categorical handling and calibration-friendly probability output.
Reuses ``MetricsResponse``/``CalibrationBin`` from models.py -- the reported
shape (AUC, n_train, n_test, calibration bins) is identical to the RVE
model's, so a second near-duplicate Pydantic model would just be drift risk
for no benefit.
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

from app.models import CalibrationBin, MetricsResponse
from app.pss_simulator import PAYMENT_METHODS

CATEGORICAL_FEATURES = ["transaction_type", "payment_method"]
NUMERIC_FEATURES = [
    "gateway_latency_ms",
    "gateway_error_rate",
    "traffic_load_index",
    "merchant_uptime_pct",
    "amount",
]
FEATURE_COLUMNS = CATEGORICAL_FEATURES + NUMERIC_FEATURES

_CATEGORY_VALUES = {
    "transaction_type": ["one_time", "subscription"],
    "payment_method": PAYMENT_METHODS,
}


def _prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df[FEATURE_COLUMNS].copy()
    for col in CATEGORICAL_FEATURES:
        out[col] = pd.Categorical(out[col], categories=_CATEGORY_VALUES[col])
    return out


@dataclass
class PSSModel:
    model: HistGradientBoostingClassifier = field(default=None)
    auc: float = 0.0
    n_train: int = 0
    n_test: int = 0
    calibration_bins: List[CalibrationBin] = field(default_factory=list)
    _is_fit: bool = False

    def fit(self, training_logs_df: pd.DataFrame, seed: int = 42) -> None:
        X = _prepare_features(training_logs_df)
        y = training_logs_df["observed_outcome"].astype(int).to_numpy()

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
            raise RuntimeError("PSSModel has not been fit yet.")
        return MetricsResponse(
            auc=self.auc,
            n_train=self.n_train,
            n_test=self.n_test,
            calibration_bins=self.calibration_bins,
        )

    def predict_proba_matrix(self, conditions: Dict) -> Dict[str, float]:
        rows = [
            {
                "transaction_type": conditions.get("transaction_type", "one_time"),
                "payment_method": method,
                "gateway_latency_ms": conditions["gateway_latency_ms"],
                "gateway_error_rate": conditions["gateway_error_rate"],
                "traffic_load_index": conditions["traffic_load_index"],
                "merchant_uptime_pct": conditions["merchant_uptime_pct"],
                "amount": conditions.get("amount", 1000.0),
            }
            for method in PAYMENT_METHODS
        ]
        X = _prepare_features(pd.DataFrame(rows))
        probs = self.model.predict_proba(X)[:, 1]
        return {method: float(p) for method, p in zip(PAYMENT_METHODS, probs)}
