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
from typing import Dict, List, Optional

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
    # --- Bootstrap ensemble, used ONLY for the confidence signal ------------
    # A parallel set of models trained on bootstrap resamples of the SAME
    # training split. Their per-prediction spread (std dev) is the
    # uncertainty signal -- ensemble DISAGREEMENT, not distance from 0.5.
    # `self.model` above is untouched and remains the point estimate that
    # drives EV / argmax everywhere; the ensemble is never used as the
    # prediction, so AUC / calibration / every pinned decision number are
    # unaffected by its presence.
    n_ensemble: int = 20
    ensemble: List[HistGradientBoostingClassifier] = field(default_factory=list)
    # Tier boundaries + escalation threshold, calibrated from the ACTUAL
    # held-out spread distribution during fit() -- never hardcoded.
    spread_p33: Optional[float] = None
    spread_p67: Optional[float] = None
    spread_p95: Optional[float] = None
    _is_fit: bool = False

    def fit(
        self,
        training_logs_df: pd.DataFrame,
        customers_df: pd.DataFrame,
        seed: int = 42,
        train_ensemble: bool = True,
    ) -> None:
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

        if train_ensemble:
            self._fit_ensemble(X_train, y_train, X_test, categorical_mask, seed)

    def _fit_ensemble(
        self,
        X_train: pd.DataFrame,
        y_train: np.ndarray,
        X_test: pd.DataFrame,
        categorical_mask: List[bool],
        seed: int,
    ) -> None:
        """Fit ``n_ensemble`` bootstrap-resampled members and calibrate the
        confidence-tier boundaries from the held-out spread distribution.

        Deterministic: bootstrap indices come from ``np.random.default_rng(seed)``
        and member ``m`` fits with ``random_state = seed + 1 + m`` (offset by 1
        so no member shares a seed with the primary ``self.model``, which uses
        ``random_state = seed``).
        """
        rng = np.random.default_rng(seed)
        n = len(X_train)
        self.ensemble = []
        for m in range(self.n_ensemble):
            idx = rng.integers(0, n, size=n)
            member = HistGradientBoostingClassifier(
                categorical_features=categorical_mask,
                random_state=seed + 1 + m,
                max_iter=200,
            )
            member.fit(X_train.iloc[idx], y_train[idx])
            self.ensemble.append(member)

        spread_test = self._ensemble_spread(X_test)
        self.spread_p33, self.spread_p67, self.spread_p95 = (
            float(v) for v in np.quantile(spread_test, [0.33, 0.67, 0.95])
        )

    def _ensemble_spread(self, features: pd.DataFrame) -> np.ndarray:
        """Per-row std dev of the ensemble members' P(recovery) predictions."""
        preds = np.stack([m.predict_proba(features)[:, 1] for m in self.ensemble], axis=0)
        return preds.std(axis=0)

    def _require_ensemble(self) -> None:
        if not self.ensemble or self.spread_p95 is None:
            raise RuntimeError(
                "Confidence ensemble not trained -- call fit(..., train_ensemble=True) first."
            )

    def confidence_tier(self, spread: float) -> str:
        """Map an ensemble spread to a display tier using the calibrated
        held-out terciles. 'low' means the models disagree a lot about this
        prediction; it does NOT by itself mean escalation (see should_escalate)."""
        self._require_ensemble()
        if spread < self.spread_p33:
            return "high"
        if spread < self.spread_p67:
            return "medium"
        return "low"

    def should_escalate(self, spread: float) -> bool:
        """True when ensemble disagreement on this prediction is in the worst
        5% of the held-out distribution -- the point past which acting on the
        number is less defensible than handing it to a human."""
        self._require_ensemble()
        return spread >= self.spread_p95

    def predict_spread_matrix(
        self, payment: Dict, customer: Dict, intervention_ids: List[str]
    ) -> Dict[str, float]:
        """Ensemble spread per intervention for one payment -- the confidence
        sibling of ``predict_proba_matrix``."""
        self._require_ensemble()
        rows = [
            {
                "failure_reason": payment["failure_reason"],
                "transaction_type": payment["transaction_type"],
                "amount": payment["amount"],
                "retry_count_so_far": payment["retry_count_so_far"],
                "past_success_rate": customer["past_success_rate"],
                "ltv": customer["ltv"],
                "assigned_intervention": intervention_id,
            }
            for intervention_id in intervention_ids
        ]
        spread = self._ensemble_spread(_prepare_features(pd.DataFrame(rows)))
        return {iid: float(s) for iid, s in zip(intervention_ids, spread)}

    def predict_spread_batch_matrix(
        self, payments_df: pd.DataFrame, customers_df: pd.DataFrame, intervention_ids: List[str]
    ) -> Dict[str, np.ndarray]:
        """Vectorized ``predict_spread_matrix`` for a whole batch -- the
        confidence sibling of ``predict_proba_batch_matrix``, used by the
        Recovery Lab digital twin."""
        self._require_ensemble()
        merged = _merge_customer_features(payments_df, customers_df)
        out: Dict[str, np.ndarray] = {}
        for intervention_id in intervention_ids:
            rows = merged.copy()
            rows["assigned_intervention"] = intervention_id
            out[intervention_id] = self._ensemble_spread(_prepare_features(rows))
        return out

    def get_metrics(self) -> MetricsResponse:
        if not self._is_fit:
            raise RuntimeError("ProbabilityModel has not been fit yet.")
        return MetricsResponse(
            auc=self.auc,
            n_train=self.n_train,
            n_test=self.n_test,
            calibration_bins=self.calibration_bins,
            n_ensemble=len(self.ensemble),
            spread_p33=self.spread_p33,
            spread_p67=self.spread_p67,
            spread_p95=self.spread_p95,
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
