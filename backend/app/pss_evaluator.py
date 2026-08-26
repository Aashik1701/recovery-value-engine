"""Offline evaluation for the Payment Success Score, against hidden ground
truth. Same evaluator/model boundary discipline as evaluator.py: this is the
ONLY module allowed to read ``_pss_simulator_truth``, via the hidden_truth
frame produced by pss_simulator.py.

Scoped down relative to evaluator.py's four-policy table: method routing
doesn't have RVE's cost/guardrail dimensions to compare policies across, so
there's one meaningful comparison here, not four -- does the trained
model's top pick beat the simplest static baseline a merchant might already
be running (always route to UPI, since it has the highest healthy-conditions
baseline)? Reported two ways: how often the model's top pick IS the true
best method for that scenario, and the mean true success probability each
policy would have actually achieved.
"""

from __future__ import annotations

from typing import List

import pandas as pd
from pydantic import BaseModel

from app.pss_model import PSSModel
from app.pss_simulator import PAYMENT_METHODS


class PSSPolicyResult(BaseModel):
    policy_name: str
    n_scenarios: int
    mean_true_success_prob: float
    top_choice_match_rate: float


def run_pss_policy_comparison(
    batch_df: pd.DataFrame, hidden_truth_df: pd.DataFrame, model: PSSModel
) -> List[PSSPolicyResult]:
    truth_by_scenario = hidden_truth_df.set_index("scenario_id")["true_success_prob"].to_dict()

    n = len(batch_df)
    baseline_true_probs = []
    baseline_matches = 0
    model_true_probs = []
    model_matches = 0

    for _, scenario in batch_df.iterrows():
        conditions = scenario.to_dict()
        true_probs = truth_by_scenario[scenario["scenario_id"]]
        true_best_method = max(PAYMENT_METHODS, key=lambda m: true_probs[m])

        baseline_choice = "upi"
        baseline_true_probs.append(true_probs[baseline_choice])
        if baseline_choice == true_best_method:
            baseline_matches += 1

        predicted_probs = model.predict_proba_matrix(conditions)
        model_choice = max(PAYMENT_METHODS, key=lambda m: predicted_probs[m])
        model_true_probs.append(true_probs[model_choice])
        if model_choice == true_best_method:
            model_matches += 1

    return [
        PSSPolicyResult(
            policy_name="always_upi",
            n_scenarios=n,
            mean_true_success_prob=round(sum(baseline_true_probs) / n, 4) if n else 0.0,
            top_choice_match_rate=round(baseline_matches / n, 4) if n else 0.0,
        ),
        PSSPolicyResult(
            policy_name="success_score_model",
            n_scenarios=n,
            mean_true_success_prob=round(sum(model_true_probs) / n, 4) if n else 0.0,
            top_choice_match_rate=round(model_matches / n, 4) if n else 0.0,
        ),
    ]
