"""Where does the EV-optimized policy actually win over the rule-based
heuristic -- everywhere equally, or concentrated in specific segments? A
single aggregate number can hide the real story (and hide a segment where
the "smarter" policy is actually worse).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/segment_breakdown.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from app import simulator
from app.ev_engine import compute_ev_for_menu
from app.guardrails import apply_guardrails, full_menu
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel

SEED = 42


def _true_ev(intervention_id: str, truth: dict, amount: float) -> float:
    prob = truth["base_recovery_prob"] + truth["uplift_by_intervention"].get(intervention_id, 0.0)
    return max(0.0, min(1.0, prob)) * amount


def main() -> None:
    bundle = simulator.run_simulation(seed=SEED)
    model = ProbabilityModel()
    model.fit(bundle.training_logs, bundle.customers, seed=SEED)

    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    truth_by_payment = bundle.hidden_truth.set_index("payment_id").to_dict(orient="index")

    def rule_based(payment: dict) -> str:
        reason = payment["failure_reason"]
        if reason in ("bank_timeout", "network_error"):
            return "retry_now"
        if reason == "insufficient_funds":
            return "retry_later"
        if payment["retry_count_so_far"] >= 2:
            return "sms_link"
        return "email"

    rows = []
    for _, payment in bundle.batch_payments.iterrows():
        payment_dict = payment.to_dict()
        customer = customers_by_id[payment["customer_id"]]
        truth = truth_by_payment[payment["payment_id"]]

        probs = model.predict_proba_matrix(payment_dict, customer, full_menu())
        ev_by_intervention = compute_ev_for_menu(probs, payment["amount"])
        eligible, _ = apply_guardrails(full_menu(), payment["amount"], payment["customer_id"], set())
        ev_choice = select_best_intervention(ev_by_intervention, eligible)

        rb_candidate = rule_based(payment_dict)
        rb_eligible, _ = apply_guardrails([rb_candidate, "no_action"], payment["amount"], payment["customer_id"], set())
        rb_choice = rb_candidate if rb_candidate in rb_eligible else "no_action"

        rows.append(
            {
                "failure_reason": payment["failure_reason"],
                "amount": payment["amount"],
                "ev_true_revenue": _true_ev(ev_choice, truth, payment["amount"]),
                "rb_true_revenue": _true_ev(rb_choice, truth, payment["amount"]),
            }
        )

    df = pd.DataFrame(rows)
    df["ev_gain"] = df["ev_true_revenue"] - df["rb_true_revenue"]

    print(f"{'failure_reason':18} {'n':>5} {'EV-opt revenue':>15} {'rule-based rev':>15} {'gain':>12} {'gain %':>8}")
    for reason, g in df.groupby("failure_reason"):
        ev_sum, rb_sum = g["ev_true_revenue"].sum(), g["rb_true_revenue"].sum()
        gain = ev_sum - rb_sum
        pct = (gain / rb_sum * 100) if rb_sum else 0.0
        print(f"{reason:18} {len(g):>5} {ev_sum:>15,.0f} {rb_sum:>15,.0f} {gain:>12,.0f} {pct:>7.1f}%")

    # Amount bands
    df["amount_band"] = pd.cut(df["amount"], bins=[0, 1000, 5000, 20000, float("inf")], labels=["<1k", "1k-5k", "5k-20k", "20k+"])
    print()
    print(f"{'amount_band':18} {'n':>5} {'EV-opt revenue':>15} {'rule-based rev':>15} {'gain':>12} {'gain %':>8}")
    for band, g in df.groupby("amount_band", observed=True):
        ev_sum, rb_sum = g["ev_true_revenue"].sum(), g["rb_true_revenue"].sum()
        gain = ev_sum - rb_sum
        pct = (gain / rb_sum * 100) if rb_sum else 0.0
        print(f"{str(band):18} {len(g):>5} {ev_sum:>15,.0f} {rb_sum:>15,.0f} {gain:>12,.0f} {pct:>7.1f}%")


if __name__ == "__main__":
    main()
