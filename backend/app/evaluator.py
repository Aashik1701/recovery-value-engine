"""Offline policy evaluation against hidden ground truth.

This is the ONLY module in the system allowed to import/read
``_simulator_truth``. The probability model and optimizer never see it --
only this evaluation harness does, which is what keeps the evaluation
honest rather than leaked.

Because the synthetic simulator's ground truth is known exactly, expected
net revenue can be computed ANALYTICALLY per policy (no Monte Carlo, no
inverse-propensity estimator needed). This simplification is only possible
because the ground truth is synthetic and fully known -- a real deployment
would need either a live randomized rollout or proper off-policy evaluation
(e.g. inverse propensity scoring) against logged production data. This is an
offline / simulator-based evaluation, not a live A/B test.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Set

import pandas as pd

from app.ev_engine import compute_ev_for_menu
from app.guardrails import apply_guardrails, full_menu
from app.models import INTERVENTION_UNIT_COSTS, PolicyResult
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel


def _true_expected_value(
    intervention_id: str, base_recovery_prob: float, uplift_by_intervention: Dict[str, float], amount: float
) -> float:
    """Exact expected revenue for one payment under one chosen intervention,
    using the HIDDEN ground truth (never the model's own prediction)."""
    true_prob = base_recovery_prob + uplift_by_intervention.get(intervention_id, 0.0)
    true_prob = max(0.0, min(1.0, true_prob))
    return true_prob * amount


def _rule_based_intervention(payment: Dict) -> str:
    """Hand-coded heuristic resembling what a merchant might build without ML.

    This is the credible competitor, not a strawman -- beating "always
    retry" is easy, beating this is the real claim of the EV-optimized
    policy.
    """
    reason = payment["failure_reason"]
    if reason in ("bank_timeout", "network_error"):
        return "retry_now"
    if reason == "insufficient_funds":
        return "retry_later"
    if payment["retry_count_so_far"] >= 2:
        return "sms_link"
    return "email"


def _score_policy(
    policy_name: str,
    payments_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    choose_fn: Callable[[Dict], str],
) -> PolicyResult:
    truth_by_payment = hidden_truth_df.set_index("payment_id").to_dict(orient="index")

    total_revenue = 0.0
    total_cost = 0.0
    n = 0
    for _, payment in payments_df.iterrows():
        payment_dict = payment.to_dict()
        truth = truth_by_payment[payment["payment_id"]]
        intervention_id = choose_fn(payment_dict)

        total_revenue += _true_expected_value(
            intervention_id, truth["base_recovery_prob"], truth["uplift_by_intervention"], payment["amount"]
        )
        total_cost += INTERVENTION_UNIT_COSTS[intervention_id]
        n += 1

    net = total_revenue - total_cost
    return PolicyResult(
        policy_name=policy_name,
        n_payments=n,
        total_expected_revenue=round(total_revenue, 2),
        total_cost=round(total_cost, 2),
        net_revenue=round(net, 2),
        net_revenue_per_rupee=round(net / total_cost, 4) if total_cost > 0 else 0.0,
    )


def run_policy_comparison(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    model: ProbabilityModel,
    suppression_list: Set[str],
) -> List[PolicyResult]:
    customers_by_id = customers_df.set_index("customer_id").to_dict(orient="index")

    def choose_do_nothing(payment: Dict) -> str:
        return "no_action"

    def choose_always_retry(payment: Dict) -> str:
        return "retry_now"

    def choose_rule_based(payment: Dict) -> str:
        candidate = _rule_based_intervention(payment)
        customer = customers_by_id[payment["customer_id"]]
        eligible, _ = apply_guardrails(
            [candidate, "no_action"], payment["amount"], payment["customer_id"], suppression_list
        )
        return candidate if candidate in eligible else "no_action"

    def choose_ev_optimized(payment: Dict) -> str:
        customer = customers_by_id[payment["customer_id"]]
        probs = model.predict_proba_matrix(payment, customer, full_menu())
        ev_by_intervention = compute_ev_for_menu(probs, payment["amount"])
        eligible, _ = apply_guardrails(
            full_menu(), payment["amount"], payment["customer_id"], suppression_list
        )
        return select_best_intervention(ev_by_intervention, eligible)

    return [
        _score_policy("always_do_nothing", batch_payments_df, hidden_truth_df, choose_do_nothing),
        _score_policy("always_retry_now", batch_payments_df, hidden_truth_df, choose_always_retry),
        _score_policy("rule_based_heuristic", batch_payments_df, hidden_truth_df, choose_rule_based),
        _score_policy("ev_optimized", batch_payments_df, hidden_truth_df, choose_ev_optimized),
    ]
