"""Robustness check for the four-policy comparison: does the EV-optimized
policy actually beat the rule-based heuristic consistently, or only on the
one seed (42) reported in docs/EVALUATION.md?

A single-seed result is a fair thing for a reviewer to be skeptical of --
this reruns the full pipeline (fresh simulation -> fresh model training ->
policy comparison) across several independent seeds and reports whether the
ranking holds every time, not just on average.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/multi_seed_evaluation.py
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import evaluator, simulator
from app.probability_model import ProbabilityModel

SEEDS = [42, 1, 7, 123, 2026]


def main() -> None:
    rows: list[dict] = []

    for seed in SEEDS:
        bundle = simulator.run_simulation(seed=seed)
        model = ProbabilityModel()
        model.fit(bundle.training_logs, bundle.customers, seed=seed)

        results = evaluator.run_policy_comparison(
            bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, suppression_list=set()
        )
        by_name = {r.policy_name: r for r in results}
        rows.append(
            {
                "seed": seed,
                "auc": round(model.auc, 3),
                "do_nothing": by_name["always_do_nothing"].net_revenue,
                "always_retry": by_name["always_retry_now"].net_revenue,
                "rule_based": by_name["rule_based_heuristic"].net_revenue,
                "ev_optimized": by_name["ev_optimized"].net_revenue,
            }
        )

    print(f"{'seed':>6} {'AUC':>6} {'do_nothing':>12} {'always_retry':>14} {'rule_based':>12} {'ev_optimized':>14} {'ev beats rule?':>16}")
    for r in rows:
        beats = "yes" if r["ev_optimized"] > r["rule_based"] else "NO"
        print(
            f"{r['seed']:>6} {r['auc']:>6} {r['do_nothing']:>12,.0f} {r['always_retry']:>14,.0f} "
            f"{r['rule_based']:>12,.0f} {r['ev_optimized']:>14,.0f} {beats:>16}"
        )

    ev_wins = sum(1 for r in rows if r["ev_optimized"] > r["rule_based"])
    print(f"\nEV-optimized beat rule-based heuristic on {ev_wins}/{len(rows)} seeds.")

    for policy in ("do_nothing", "always_retry", "rule_based", "ev_optimized"):
        values = [r[policy] for r in rows]
        print(
            f"{policy:14} mean net revenue = Rs.{statistics.mean(values):,.0f}  "
            f"(min Rs.{min(values):,.0f}, max Rs.{max(values):,.0f})"
        )


if __name__ == "__main__":
    main()
