"""Resolves the open model-choice decision in CLAUDE.md Section 19:
HistGradientBoostingClassifier (current default) vs. logistic regression
with one-hot encoding (the documented fallback "if calibration proves
easier to reason about"). Trains both on the identical train/test split and
reports AUC + Brier score (lower is better-calibrated) side by side.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/compare_models.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer

from app import simulator
from app.probability_model import CATEGORICAL_FEATURES, NUMERIC_FEATURES, FEATURE_COLUMNS, _merge_customer_features, _prepare_features

SEED = 42


def main() -> None:
    bundle = simulator.run_simulation(seed=SEED)
    merged = _merge_customer_features(bundle.training_logs, bundle.customers)
    X = _prepare_features(merged)
    y = merged["observed_outcome"].astype(int).to_numpy()

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=SEED, stratify=y)

    # --- Model A: HistGradientBoostingClassifier (current default) ---
    categorical_mask = [c in CATEGORICAL_FEATURES for c in FEATURE_COLUMNS]
    gbm = HistGradientBoostingClassifier(categorical_features=categorical_mask, random_state=SEED, max_iter=200)
    gbm.fit(X_train, y_train)
    gbm_probs = gbm.predict_proba(X_test)[:, 1]

    # --- Model B: Logistic regression, one-hot + scaled numeric ---
    preprocessor = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("num", StandardScaler(), NUMERIC_FEATURES),
        ]
    )
    logreg = Pipeline(
        [("prep", preprocessor), ("clf", LogisticRegression(max_iter=1000, random_state=SEED))]
    )
    # LogisticRegression's OneHotEncoder can't take pandas Categorical the
    # same way HGB does -- cast back to plain object/string columns for it.
    X_train_lr = X_train.copy()
    X_test_lr = X_test.copy()
    for col in CATEGORICAL_FEATURES:
        X_train_lr[col] = X_train_lr[col].astype(str)
        X_test_lr[col] = X_test_lr[col].astype(str)
    logreg.fit(X_train_lr, y_train)
    logreg_probs = logreg.predict_proba(X_test_lr)[:, 1]

    for name, probs in [("HistGradientBoosting (current default)", gbm_probs), ("Logistic regression (fallback candidate)", logreg_probs)]:
        auc = roc_auc_score(y_test, probs)
        brier = brier_score_loss(y_test, probs)
        print(f"{name:42} AUC={auc:.4f}  Brier={brier:.4f} (lower is better-calibrated)")


if __name__ == "__main__":
    main()
