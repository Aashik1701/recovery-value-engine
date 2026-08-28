"""Adversarial evaluation harness -- Final Validation / Demo Hardening phase.

This script does NOT implement a second decision engine. Every test below
calls the EXISTING pipeline (app.simulator, app.probability_model, app.ev_engine,
app.optimizer, app.guardrails, app.evaluator) exactly as main.py / the other
scripts in this directory do. Its job is to stress that pipeline from angles
the single-seed, single-scenario numbers in docs/EVALUATION.md don't cover,
and to report what it finds honestly -- including any case where the
EV-optimized policy does NOT win.

Nothing here permanently mutates a production constant. Tests that need to
vary costs or the population distribution monkeypatch a module attribute
inside a try/finally and restore it before returning, so a crash mid-test
can't leave process-global state corrupted for a later test.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/adversarial_evaluation.py [--quick]

--quick shrinks seed counts / batch sizes for a fast sanity pass during
development; the numbers quoted in docs/JUDGE_EVIDENCE.md come from a full
(non --quick) run.
"""

from __future__ import annotations

import copy
import json
import statistics
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from app import ev_engine, evaluator, simulator
from app.guardrails import apply_guardrails, full_menu
from app.models import INTERVENTION_UNIT_COSTS, VOICE_CALL_AMOUNT_THRESHOLD
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel

RESULTS: Dict[str, object] = {}

SEEDS_20 = [42, 1, 7, 123, 2026, 3, 11, 19, 55, 77, 99, 101, 256, 314, 500, 777, 808, 999, 1234, 9999]

QUICK = "--quick" in sys.argv
DEBUG = "--debug" in sys.argv  # tiny sizes/seed count, for catching code bugs fast -- not for citable numbers
if DEBUG:
    SEEDS_20 = SEEDS_20[:3]
    N_TRAINING_LOGS, N_BATCH_PAYMENTS, N_CUSTOMERS = 1_000, 40, 100
elif QUICK:
    N_TRAINING_LOGS, N_BATCH_PAYMENTS, N_CUSTOMERS = 8_000, 200, 800
else:
    N_TRAINING_LOGS, N_BATCH_PAYMENTS, N_CUSTOMERS = 30_000, 500, 2_000


def _section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def _fit(seed: int) -> tuple[simulator.SimulationBundle, ProbabilityModel]:
    bundle = simulator.run_simulation(
        n_customers=N_CUSTOMERS, n_training_logs=N_TRAINING_LOGS, n_batch_payments=N_BATCH_PAYMENTS, seed=seed
    )
    model = ProbabilityModel()
    model.fit(bundle.training_logs, bundle.customers, seed=seed)
    return bundle, model


# ---------------------------------------------------------------------------
# TEST A -- a stronger, still-credible rule-based competitor
# ---------------------------------------------------------------------------
#
# docs/EVALUATION.md's existing heuristic ignores amount entirely and never
# uses voice_call. A merchant ops person who had read this project's own
# simulator assumptions (Section 4 of AGENTS.md: different failure reasons
# imply different customer intent) could plausibly write something sharper:
# route fraud_block to no_action instead of wasting contact cost on a
# near-zero-uplift reason, escalate high-value insufficient_funds/card_expired
# payments to voice_call (the single highest-uplift channel for both reasons
# per simulator.py's own UPLIFT_BY_REASON_AND_INTERVENTION table), and use
# retry count as a signal to escalate touch rather than a blanket cutoff.
# This is deliberately built to be a genuine improvement over the existing
# heuristic -- if EV-optimized can't beat this, that's the honest finding.


def _stronger_rule_based_intervention(payment: Dict) -> str:
    reason = payment["failure_reason"]
    amount = payment["amount"]
    retries = payment["retry_count_so_far"]

    if reason in ("bank_timeout", "network_error"):
        return "retry_now"
    if reason == "fraud_block":
        # Every uplift for this reason is ~0-2pp (simulator.py); no channel
        # clears its own cost. Contacting anyway is a net-negative rule.
        return "no_action"
    if reason == "insufficient_funds":
        if amount >= 10_000:
            return "voice_call"  # highest uplift for this reason (0.18) once amount clears its cost
        if retries >= 2:
            return "whatsapp_nudge"  # organic retries already failed -- escalate touch
        return "retry_later"  # cheap, timing-sensitive, second-highest uplift
    if reason == "card_expired":
        # A channel problem, not an intent problem -- sms/email under-serve it.
        return "voice_call" if amount >= 10_000 else "whatsapp_nudge"
    # other
    return "whatsapp_nudge" if amount >= 5_000 else "sms_link"


def _choose_strong_rule_factory(customers_by_id: Dict, suppression_list: set) -> Callable[[Dict], str]:
    def choose(payment: Dict) -> str:
        candidate = _stronger_rule_based_intervention(payment)
        eligible, _ = apply_guardrails([candidate, "no_action"], payment["amount"], payment["customer_id"], suppression_list)
        return candidate if candidate in eligible else "no_action"

    return choose


def test_a_stronger_rule(bundle: simulator.SimulationBundle, model: ProbabilityModel) -> Dict:
    _section("TEST A -- stronger rule-based competitor (single seed=42 detail)")
    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    baseline = evaluator.run_policy_comparison(bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set())
    by_name = {r.policy_name: r for r in baseline}

    strong = evaluator._score_policy(
        "strong_rule_based", bundle.batch_payments, bundle.hidden_truth,
        _choose_strong_rule_factory(customers_by_id, set()),
    )

    rows = [
        ("always_do_nothing", by_name["always_do_nothing"]),
        ("always_retry_now", by_name["always_retry_now"]),
        ("rule_based_heuristic (existing)", by_name["rule_based_heuristic"]),
        ("strong_rule_based (new)", strong),
        ("ev_optimized (RVE)", by_name["ev_optimized"]),
    ]
    print(f"{'policy':32} {'net_revenue':>14} {'cost':>10}")
    for name, r in rows:
        print(f"{name:32} {r.net_revenue:>14,.2f} {r.total_cost:>10,.2f}")

    ev_vs_strong = by_name["ev_optimized"].net_revenue - strong.net_revenue
    ev_vs_strong_pct = ev_vs_strong / strong.net_revenue * 100 if strong.net_revenue else float("nan")
    print(f"\nEV-optimized vs strong rule: {'WINS' if ev_vs_strong > 0 else 'LOSES'} by Rs.{ev_vs_strong:,.2f} ({ev_vs_strong_pct:+.1f}%)")

    return {
        "policies": {name: r.net_revenue for name, r in rows},
        "ev_vs_strong_rule_delta": round(ev_vs_strong, 2),
        "ev_beats_strong_rule": ev_vs_strong > 0,
    }


# ---------------------------------------------------------------------------
# TEST B -- 20 independent seeds, both baselines
# ---------------------------------------------------------------------------


def test_b_20_seeds() -> Dict:
    _section(f"TEST B -- {len(SEEDS_20)} independent seeds (do_nothing / always_retry / rule / strong_rule / RVE)")
    rows: List[Dict] = []
    for seed in SEEDS_20:
        bundle, model = _fit(seed)
        customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
        baseline = evaluator.run_policy_comparison(bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set())
        by_name = {r.policy_name: r for r in baseline}
        strong = evaluator._score_policy(
            "strong_rule_based", bundle.batch_payments, bundle.hidden_truth,
            _choose_strong_rule_factory(customers_by_id, set()),
        )
        rve = by_name["ev_optimized"].net_revenue
        rule = by_name["rule_based_heuristic"].net_revenue
        rows.append({
            "seed": seed,
            "auc": round(model.auc, 4),
            "do_nothing": by_name["always_do_nothing"].net_revenue,
            "always_retry": by_name["always_retry_now"].net_revenue,
            "rule_based": rule,
            "strong_rule": strong.net_revenue,
            "rve": rve,
            "rve_vs_rule": rve - rule,
            "rve_vs_strong_rule": rve - strong.net_revenue,
        })

    print(f"{'seed':>6} {'AUC':>7} {'rule_based':>12} {'strong_rule':>12} {'RVE':>12} {'RVE-rule':>10} {'RVE-strong':>11}")
    for r in rows:
        print(f"{r['seed']:>6} {r['auc']:>7} {r['rule_based']:>12,.0f} {r['strong_rule']:>12,.0f} "
              f"{r['rve']:>12,.0f} {r['rve_vs_rule']:>10,.0f} {r['rve_vs_strong_rule']:>11,.0f}")

    def stats(key: str) -> Dict:
        vals = [r[key] for r in rows]
        return {
            "mean": round(statistics.mean(vals), 2),
            "median": round(statistics.median(vals), 2),
            "stdev": round(statistics.stdev(vals), 2) if len(vals) > 1 else 0.0,
            "min": round(min(vals), 2),
            "max": round(max(vals), 2),
        }

    win_rate_rule = sum(1 for r in rows if r["rve_vs_rule"] > 0) / len(rows)
    win_rate_strong = sum(1 for r in rows if r["rve_vs_strong_rule"] > 0) / len(rows)

    print(f"\nRVE beats existing rule-based heuristic on {sum(1 for r in rows if r['rve_vs_rule'] > 0)}/{len(rows)} seeds "
          f"(win rate {win_rate_rule:.0%})")
    print(f"RVE beats strong rule-based heuristic on {sum(1 for r in rows if r['rve_vs_strong_rule'] > 0)}/{len(rows)} seeds "
          f"(win rate {win_rate_strong:.0%})")
    for key in ("do_nothing", "always_retry", "rule_based", "strong_rule", "rve"):
        s = stats(key)
        print(f"{key:14} mean=Rs.{s['mean']:,.0f} median=Rs.{s['median']:,.0f} stdev=Rs.{s['stdev']:,.0f} "
              f"min=Rs.{s['min']:,.0f} max=Rs.{s['max']:,.0f}")

    return {
        "rows": rows,
        "win_rate_vs_rule_based": win_rate_rule,
        "win_rate_vs_strong_rule": win_rate_strong,
        "stats": {k: stats(k) for k in ("do_nothing", "always_retry", "rule_based", "strong_rule", "rve")},
    }


# ---------------------------------------------------------------------------
# TEST C -- payment-amount stress test
# ---------------------------------------------------------------------------


def test_c_amount_stress(model: ProbabilityModel) -> Dict:
    _section("TEST C -- payment amount stress test (failure_reason=insufficient_funds, retries=0)")
    amounts = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000]
    customer = {"past_success_rate": 0.6, "ltv": 50_000.0}
    rows = []
    print(f"{'amount':>10} {'chosen':>15} {'P(recovery)':>12} {'cost':>8} {'EV':>12} {'voice eligible?':>16}")
    for amount in amounts:
        payment = {"failure_reason": "insufficient_funds", "transaction_type": "one_time",
                   "amount": float(amount), "retry_count_so_far": 0}
        probs = model.predict_proba_matrix(payment, customer, full_menu())
        ev = ev_engine.compute_ev_for_menu(probs, amount)
        eligible, blocked = apply_guardrails(full_menu(), amount, "probe_customer", set())
        chosen = select_best_intervention(ev, eligible)
        voice_eligible = "voice_call" in eligible
        print(f"{amount:>10,.0f} {chosen:>15} {probs[chosen]:>12.2%} {INTERVENTION_UNIT_COSTS[chosen]:>8.2f} "
              f"{ev[chosen]:>12,.2f} {str(voice_eligible):>16}")
        rows.append({
            "amount": amount, "chosen": chosen, "probability": round(probs[chosen], 4),
            "cost": INTERVENTION_UNIT_COSTS[chosen], "ev": round(ev[chosen], 2), "voice_eligible": voice_eligible,
        })

    # Sanity checks a hostile reviewer would run: below-threshold amounts must
    # never select voice_call (guardrail), and the *most expensive* channel
    # must not be selected purely because amount is large -- it has to be the
    # highest-EV eligible one, which we verify against the full menu.
    below_threshold = [r for r in rows if r["amount"] < VOICE_CALL_AMOUNT_THRESHOLD]
    voice_below_threshold = any(r["chosen"] == "voice_call" for r in below_threshold)
    always_most_expensive = all(r["chosen"] == "voice_call" for r in rows if r["voice_eligible"])

    print(f"\nvoice_call ever chosen below Rs.{VOICE_CALL_AMOUNT_THRESHOLD:,.0f} threshold: {voice_below_threshold} (must be False)")
    print(f"voice_call chosen for EVERY voice-eligible amount (would indicate 'pick expensive because amount is large'): "
          f"{always_most_expensive} (expected False unless genuinely EV-optimal every time)")

    return {"rows": rows, "voice_below_threshold_violation": voice_below_threshold}


# ---------------------------------------------------------------------------
# TEST D -- failure-reason stress test
# ---------------------------------------------------------------------------


def test_d_failure_reason_stress(model: ProbabilityModel) -> Dict:
    _section("TEST D -- failure reason stress test (amount=Rs.3,000, retries=0)")
    reasons = ["insufficient_funds", "bank_timeout", "network_error", "card_expired", "fraud_block", "other"]
    customer = {"past_success_rate": 0.6, "ltv": 50_000.0}
    amount = 3_000.0
    rows = []
    for reason in reasons:
        payment = {"failure_reason": reason, "transaction_type": "one_time", "amount": amount, "retry_count_so_far": 0}
        probs = model.predict_proba_matrix(payment, customer, full_menu())
        ev = ev_engine.compute_ev_for_menu(probs, amount)
        eligible, blocked = apply_guardrails(full_menu(), amount, "probe_customer", set())
        chosen = select_best_intervention(ev, eligible)
        expensive_chosen = chosen in ("whatsapp_nudge", "voice_call")
        print(f"\n{reason} -> chosen: {chosen}  (P={probs[chosen]:.2%}, EV=Rs.{ev[chosen]:,.2f})")
        for iid in full_menu():
            status = "BLOCKED: " + blocked[iid] if iid in blocked else ("CHOSEN" if iid == chosen else "eligible, not chosen")
            print(f"    {iid:16} P={probs[iid]:.2%}  cost=Rs.{INTERVENTION_UNIT_COSTS[iid]:5.2f}  EV=Rs.{ev[iid]:9,.2f}  {status}")
        rows.append({
            "failure_reason": reason, "chosen": chosen, "probability": round(probs[chosen], 4),
            "ev": round(ev[chosen], 2), "expensive_channel_chosen": expensive_chosen,
        })

    transient_expensive = [r for r in rows if r["failure_reason"] in ("bank_timeout", "network_error") and r["expensive_channel_chosen"]]
    fraud_row = next(r for r in rows if r["failure_reason"] == "fraud_block")
    print(f"\nTransient failures (bank_timeout/network_error) that picked an expensive channel "
          f"(whatsapp/voice): {len(transient_expensive)} (expect 0 -- transient failures resolve organically, "
          f"so retry_now's near-zero cost should usually win)")
    print(f"fraud_block chosen intervention: {fraud_row['chosen']} at EV=Rs.{fraud_row['ev']:,.2f}")

    return {"rows": rows, "transient_expensive_count": len(transient_expensive)}


# ---------------------------------------------------------------------------
# TEST E -- customer contact history / guardrail stress test
# ---------------------------------------------------------------------------


def test_e_contact_history(model: ProbabilityModel) -> Dict:
    _section("TEST E -- customer contact history (amount=Rs.6,000, insufficient_funds; voice-eligible amount)")
    amount = 6_000.0
    customer = {"past_success_rate": 0.6, "ltv": 50_000.0}
    payment = {"failure_reason": "insufficient_funds", "transaction_type": "one_time", "amount": amount, "retry_count_so_far": 1}
    probs = model.predict_proba_matrix(payment, customer, full_menu())
    ev = ev_engine.compute_ev_for_menu(probs, amount)

    rows = []
    for prior in [0, 1, 2, 3, 5]:
        eligible, blocked = apply_guardrails(full_menu(), amount, "probe_customer", set(), prior_contact_count=prior)
        chosen = select_best_intervention(ev, eligible)
        contact_ids_eligible = [iid for iid in eligible if iid not in ("no_action", "retry_now")]
        print(f"prior_contact_count={prior}: eligible={eligible} -> chosen={chosen} "
              f"(contact-requiring options still open: {contact_ids_eligible})")
        rows.append({"prior_contact_count": prior, "eligible": eligible, "chosen": chosen})

    # A prohibited intervention must never reach argmax: once prior >= cap (2),
    # no contact-requiring intervention may appear in `eligible`.
    cap_violations = [
        r for r in rows
        if r["prior_contact_count"] >= 2 and any(i not in ("no_action", "retry_now") for i in r["eligible"])
    ]
    print(f"\nContact-cap violations (contact-requiring option eligible at/above cap): {len(cap_violations)} (must be 0)")

    # Suppression list check, same payment.
    print("\n-- suppression list --")
    eligible_supp, blocked_supp = apply_guardrails(full_menu(), amount, "suppressed_customer", {"suppressed_customer"})
    chosen_supp = select_best_intervention(ev, eligible_supp)
    print(f"suppressed customer -> eligible={eligible_supp} -> chosen={chosen_supp}")
    non_contact_only = all(i in ("no_action", "retry_now") for i in eligible_supp)
    print(f"Only non-contact interventions eligible for a suppressed customer: {non_contact_only} (must be True)")

    return {
        "rows": rows,
        "cap_violations": len(cap_violations),
        "suppression_non_contact_only": non_contact_only,
    }


# ---------------------------------------------------------------------------
# TEST F -- cost sensitivity (injected, not a permanent constant change)
# ---------------------------------------------------------------------------


def test_f_cost_sensitivity(bundle: simulator.SimulationBundle, model: ProbabilityModel) -> Dict:
    _section("TEST F -- cost sensitivity (voice_call and whatsapp_nudge costs varied)")
    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    truth_by_payment = bundle.hidden_truth.set_index("payment_id").to_dict(orient="index")

    original_costs = dict(ev_engine.INTERVENTION_UNIT_COSTS)
    scenarios = {
        "baseline (voice=15, whatsapp=5)": {},
        "voice cheaper (voice=5)": {"voice_call": 5.0},
        "voice much more expensive (voice=60)": {"voice_call": 60.0},
        "whatsapp more expensive (whatsapp=20)": {"whatsapp_nudge": 20.0},
        "sms cheaper (sms=0.5)": {"sms_link": 0.5},
    }

    results = {}
    try:
        for label, overrides in scenarios.items():
            ev_engine.INTERVENTION_UNIT_COSTS = {**original_costs, **overrides}
            voice_count, whatsapp_count, sms_count = 0, 0, 0
            total_net = 0.0
            for _, payment in bundle.batch_payments.iterrows():
                payment_dict = payment.to_dict()
                customer = customers_by_id[payment["customer_id"]]
                probs = model.predict_proba_matrix(payment_dict, customer, full_menu())
                ev = ev_engine.compute_ev_for_menu(probs, payment["amount"])
                eligible, _ = apply_guardrails(full_menu(), payment["amount"], payment["customer_id"], set())
                chosen = select_best_intervention(ev, eligible)
                if chosen == "voice_call":
                    voice_count += 1
                elif chosen == "whatsapp_nudge":
                    whatsapp_count += 1
                elif chosen == "sms_link":
                    sms_count += 1
                truth = truth_by_payment[payment["payment_id"]]
                true_prob = max(0.0, min(1.0, truth["base_recovery_prob"] + truth["uplift_by_intervention"].get(chosen, 0.0)))
                total_net += true_prob * payment["amount"] - ev_engine.INTERVENTION_UNIT_COSTS[chosen]
            n = len(bundle.batch_payments)
            print(f"{label:42} voice={voice_count:4}/{n} ({voice_count/n:5.1%})  "
                  f"whatsapp={whatsapp_count:4} ({whatsapp_count/n:5.1%})  sms={sms_count:4} ({sms_count/n:5.1%})  "
                  f"net_revenue=Rs.{total_net:,.0f}")
            results[label] = {"voice_call_rate": voice_count / n, "whatsapp_rate": whatsapp_count / n,
                               "sms_rate": sms_count / n, "net_revenue": round(total_net, 2)}
    finally:
        ev_engine.INTERVENTION_UNIT_COSTS = original_costs

    cheap = results["voice cheaper (voice=5)"]["voice_call_rate"]
    base = results["baseline (voice=15, whatsapp=5)"]["voice_call_rate"]
    expensive = results["voice much more expensive (voice=60)"]["voice_call_rate"]
    responds = cheap >= base >= expensive
    print(f"\nvoice_call selection rate strictly responds to its own cost "
          f"(cheap {cheap:.1%} >= baseline {base:.1%} >= expensive {expensive:.1%}): {responds}")

    return {"scenarios": results, "voice_cost_monotonic": responds}


# ---------------------------------------------------------------------------
# TEST G -- model probability noise / degradation
# ---------------------------------------------------------------------------


def _degrade(probs: Dict[str, float], mode: str, magnitude: float, rng: np.random.Generator) -> Dict[str, float]:
    out = {}
    for iid, p in probs.items():
        if mode == "shrinkage":
            # magnitude=1.0 -> fully collapsed to 0.5 (an uninformative model).
            out[iid] = 0.5 + (1.0 - magnitude) * (p - 0.5)
        elif mode == "noise":
            out[iid] = float(np.clip(p + rng.normal(0, magnitude), 0.0, 1.0))
        else:
            raise ValueError(mode)
    return out


def test_g_model_degradation(bundle: simulator.SimulationBundle, model: ProbabilityModel) -> Dict:
    _section("TEST G -- model probability degradation (does the optimizer degrade gracefully?)")
    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    rng = np.random.default_rng(0)

    def choose_degraded(mode: str, magnitude: float) -> Callable[[Dict], str]:
        def choose(payment: Dict) -> str:
            customer = customers_by_id[payment["customer_id"]]
            probs = model.predict_proba_matrix(payment, customer, full_menu())
            probs = _degrade(probs, mode, magnitude, rng)
            ev = ev_engine.compute_ev_for_menu(probs, payment["amount"])
            eligible, _ = apply_guardrails(full_menu(), payment["amount"], payment["customer_id"], set())
            return select_best_intervention(ev, eligible)
        return choose

    baseline_result = evaluator._score_policy(
        "ev_optimized_clean", bundle.batch_payments, bundle.hidden_truth,
        lambda p: select_best_intervention(
            ev_engine.compute_ev_for_menu(model.predict_proba_matrix(p, customers_by_id[p["customer_id"]], full_menu()), p["amount"]),
            apply_guardrails(full_menu(), p["amount"], p["customer_id"], set())[0],
        ),
    )
    do_nothing_result = next(r for r in evaluator.run_policy_comparison(
        bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set()
    ) if r.policy_name == "always_do_nothing")

    print(f"{'scenario':30} {'net_revenue':>14} {'vs clean':>12} {'above do-nothing floor?':>24}")
    print(f"{'clean model':30} {baseline_result.net_revenue:>14,.2f} {'--':>12} {'--':>24}")
    rows = []
    for mode, magnitudes in (("shrinkage", [0.2, 0.5, 0.8, 1.0]), ("noise", [0.05, 0.1, 0.2, 0.4])):
        for mag in magnitudes:
            result = evaluator._score_policy(f"{mode}_{mag}", bundle.batch_payments, bundle.hidden_truth, choose_degraded(mode, mag))
            delta = result.net_revenue - baseline_result.net_revenue
            above_floor = result.net_revenue >= do_nothing_result.net_revenue
            print(f"{mode + ' ' + str(mag):30} {result.net_revenue:>14,.2f} {delta:>12,.2f} {str(above_floor):>24}")
            rows.append({"mode": mode, "magnitude": mag, "net_revenue": result.net_revenue,
                         "delta_vs_clean": round(delta, 2), "above_do_nothing_floor": above_floor})

    # At magnitude=1.0 shrinkage the model is fully uninformative (every
    # probability collapses to 0.5) -- the system must not crash, must not
    # raise, and must still only pick from the guardrail-eligible set. It is
    # NOT required to still beat do-nothing (an uninformative EV policy can
    # legitimately be worse than doing nothing, since it will happily "pay"
    # for expensive contact-heavy channels whenever amount is large enough to
    # make 0.5*amount - cost positive, even for fraud_block payments whose
    # true recovery chance is far below 50%) -- that is itself an honest,
    # reportable finding about the optimizer's total dependency on the model
    # being calibrated, not a bug to hide.
    fully_degraded = next(r for r in rows if r["mode"] == "shrinkage" and r["magnitude"] == 1.0)
    print(f"\nFully-uninformative model (shrinkage=1.0) still beats do-nothing: "
          f"{fully_degraded['above_do_nothing_floor']} -- {'reassuring but not guaranteed' if fully_degraded['above_do_nothing_floor'] else 'EXPECTED FAILURE MODE: a mis-calibrated model can lose to doing nothing -- this is why calibration (docs/EVALUATION.md AUC/Brier) matters operationally'}")

    return {"rows": rows, "baseline_net_revenue": baseline_result.net_revenue,
            "do_nothing_net_revenue": do_nothing_result.net_revenue}


# ---------------------------------------------------------------------------
# TEST H -- feature ablation
# ---------------------------------------------------------------------------


def _ablate(training_logs: pd.DataFrame, customers: pd.DataFrame, batch: pd.DataFrame, feature: str):
    training_logs = training_logs.copy()
    customers = customers.copy()
    batch = batch.copy()
    if feature in ("past_success_rate", "ltv"):
        const = customers[feature].mean()
        customers[feature] = const
    else:
        if pd.api.types.is_numeric_dtype(training_logs[feature]):
            const = training_logs[feature].mean()
        else:
            const = training_logs[feature].mode().iloc[0]
        training_logs[feature] = const
        if feature in batch.columns:
            batch[feature] = const
    return training_logs, customers, batch


def test_h_feature_ablation(bundle: simulator.SimulationBundle, baseline_auc: float, baseline_net: float) -> Dict:
    _section("TEST H -- feature ablation (leave-one-feature-out retrain, seed=42)")
    features = ["failure_reason", "amount", "retry_count_so_far", "past_success_rate", "ltv"]
    print(f"baseline (all features): AUC={baseline_auc:.4f}  ev_optimized net_revenue=Rs.{baseline_net:,.2f}\n")

    rows = []
    for feature in features:
        ablated_logs, ablated_customers, ablated_batch = _ablate(
            bundle.training_logs, bundle.customers, bundle.batch_payments, feature
        )
        model = ProbabilityModel()
        model.fit(ablated_logs, ablated_customers, seed=42)
        results = evaluator.run_policy_comparison(ablated_batch, ablated_customers, bundle.hidden_truth, model, set())
        net = next(r for r in results if r.policy_name == "ev_optimized").net_revenue
        auc_drop = baseline_auc - model.auc
        net_drop = baseline_net - net
        print(f"without {feature:20} AUC={model.auc:.4f} (drop {auc_drop:+.4f})   "
              f"net_revenue=Rs.{net:,.2f} (drop Rs.{net_drop:+,.2f})")
        rows.append({"feature_removed": feature, "auc": round(model.auc, 4), "auc_drop": round(auc_drop, 4),
                     "net_revenue": round(net, 2), "net_revenue_drop": round(net_drop, 2)})

    ranked = sorted(rows, key=lambda r: r["net_revenue_drop"], reverse=True)
    print("\nMost decision-relevant features (largest net-revenue drop when removed):")
    for r in ranked:
        print(f"  {r['feature_removed']:20} drop=Rs.{r['net_revenue_drop']:,.2f}")

    return {"rows": rows}


# ---------------------------------------------------------------------------
# TEST I -- distribution shift
# ---------------------------------------------------------------------------


def test_i_distribution_shift() -> Dict:
    _section("TEST I -- distribution shift (does the system stay stable under a different population?)")
    original_weights = dict(simulator.FAILURE_REASON_WEIGHTS)
    original_sample_amount = simulator._sample_amount

    def _biased_amount_high(rng: np.random.Generator) -> float:
        return float(np.clip(rng.lognormal(mean=9.5, sigma=1.0), 50, 200_000))

    def _biased_amount_low(rng: np.random.Generator) -> float:
        return float(np.clip(rng.lognormal(mean=5.5, sigma=0.8), 50, 200_000))

    scenarios: Dict[str, Dict] = {
        "baseline": {"weights": None, "amount_fn": None},
        "insufficient_funds-heavy": {
            "weights": {"insufficient_funds": 0.60, "bank_timeout": 0.10, "network_error": 0.08,
                        "card_expired": 0.10, "fraud_block": 0.02, "other": 0.10},
            "amount_fn": None,
        },
        "transient-heavy (bank_timeout/network_error)": {
            "weights": {"insufficient_funds": 0.10, "bank_timeout": 0.40, "network_error": 0.35,
                        "card_expired": 0.05, "fraud_block": 0.02, "other": 0.08},
            "amount_fn": None,
        },
        "high-value-heavy population": {"weights": None, "amount_fn": _biased_amount_high},
        "low-value-heavy population": {"weights": None, "amount_fn": _biased_amount_low},
    }

    results = {}
    try:
        for label, cfg in scenarios.items():
            if cfg["weights"] is not None:
                simulator.FAILURE_REASON_WEIGHTS = cfg["weights"]
            else:
                simulator.FAILURE_REASON_WEIGHTS = original_weights
            if cfg["amount_fn"] is not None:
                simulator._sample_amount = cfg["amount_fn"]
            else:
                simulator._sample_amount = original_sample_amount

            bundle = simulator.run_simulation(
                n_customers=N_CUSTOMERS, n_training_logs=N_TRAINING_LOGS, n_batch_payments=N_BATCH_PAYMENTS, seed=42
            )
            model = ProbabilityModel()
            model.fit(bundle.training_logs, bundle.customers, seed=42)
            policy_results = evaluator.run_policy_comparison(bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set())
            by_name = {r.policy_name: r for r in policy_results}
            rve = by_name["ev_optimized"].net_revenue
            rule = by_name["rule_based_heuristic"].net_revenue
            median_amount = float(bundle.batch_payments["amount"].median())
            print(f"{label:44} AUC={model.auc:.4f}  median_amount=Rs.{median_amount:8,.0f}  "
                  f"RVE=Rs.{rve:>12,.0f}  rule=Rs.{rule:>12,.0f}  RVE beats rule: {rve > rule}")
            results[label] = {"auc": round(model.auc, 4), "median_amount": round(median_amount, 2),
                               "rve_net_revenue": round(rve, 2), "rule_net_revenue": round(rule, 2),
                               "rve_beats_rule": rve > rule}
    finally:
        simulator.FAILURE_REASON_WEIGHTS = original_weights
        simulator._sample_amount = original_sample_amount

    all_stable = all(r["rve_net_revenue"] > 0 for r in results.values())
    print(f"\nAll scenarios produced a valid, non-crashing, positive net revenue for RVE: {all_stable}")
    return {"scenarios": results, "all_stable": all_stable}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> None:
    print(f"Adversarial evaluation harness{'(--quick mode)' if QUICK else ''}")
    print(f"n_customers={N_CUSTOMERS} n_training_logs={N_TRAINING_LOGS} n_batch_payments={N_BATCH_PAYMENTS}")

    bundle, model = _fit(seed=42)

    RESULTS["test_a"] = test_a_stronger_rule(bundle, model)
    RESULTS["test_b"] = test_b_20_seeds()

    if "--ab-only" in sys.argv:
        # A/B at full docs/EVALUATION.md scale is expensive (20 seeds x a
        # full 2,000/30,000/500 simulate+train each) -- this flag exists so a
        # scale check on just the two seed-sensitive tests doesn't require
        # re-running the full C-I suite at that scale too.
        out_path = Path(__file__).resolve().parent.parent.parent / "docs" / "adversarial_evaluation_results_ab_fullscale.json"
        with open(out_path, "w") as f:
            json.dump(RESULTS, f, indent=2, default=str)
        _section(f"--ab-only: results written to {out_path}")
        return
    RESULTS["test_c"] = test_c_amount_stress(model)
    RESULTS["test_d"] = test_d_failure_reason_stress(model)
    RESULTS["test_e"] = test_e_contact_history(model)
    RESULTS["test_f"] = test_f_cost_sensitivity(bundle, model)
    RESULTS["test_g"] = test_g_model_degradation(bundle, model)

    baseline_results = evaluator.run_policy_comparison(bundle.batch_payments, bundle.customers, bundle.hidden_truth, model, set())
    baseline_net = next(r for r in baseline_results if r.policy_name == "ev_optimized").net_revenue
    RESULTS["test_h"] = test_h_feature_ablation(bundle, model.auc, baseline_net)
    RESULTS["test_i"] = test_i_distribution_shift()

    out_path = Path(__file__).resolve().parent.parent.parent / "docs" / "adversarial_evaluation_results.json"
    out_path.parent.mkdir(exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(RESULTS, f, indent=2, default=str)
    _section(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
