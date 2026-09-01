"""Recovery Lab -- "Revenue Recovery Digital Twin" simulation engine.

Product framing (see docs/RECOVERY_DIGITAL_TWIN.md): the rest
of this repo decides ONE failed payment at a time (simulator -> probability
model -> EV engine -> optimizer -> guardrails -> chosen intervention). This
module sits a level above that: given a merchant-level recovery STRATEGY
(a policy plus resource constraints), it simulates the outcome of applying
that strategy to the entire synthetic failed-payment population, so a
merchant can compare strategies and find an economically efficient operating
point BEFORE deploying anything.

Hard boundary (non-negotiable, per this project's design intent):
this module is OFFLINE and SYNTHETIC. It never calls Razorpay, never sends a
real message, never mutates real payment or audit state -- it only reads the
existing synthetic simulator population/model (module-level state owned by
main.py) and does arithmetic on top of it.

Like evaluator.py, this module is one of the few places allowed to read the
hidden ``_simulator_truth`` table -- "what would have happened under a
policy we didn't actually run" is exactly the offline-evaluation question,
not a live decision, so the same architectural exception applies here.

Reuses rather than duplicates:
  * the synthetic population + trained model (passed in by main.py)
  * app.guardrails.apply_guardrails (contact cap / voice threshold / suppression)
  * app.ev_engine.compute_ev_for_menu
  * app.optimizer.select_best_intervention
  * app.probability_model.ProbabilityModel.predict_proba_batch_matrix

Simplifications documented here, not hidden:
  * Global scarce resources (voice_capacity, discount_budget) are allocated
    by a priority ranking (expected value for rve_adaptive, raw payment
    amount as a proxy for the other three policies, which have no EV
    concept of their own) -- greedy highest-priority-first, not a joint
    optimization across both resources at once.
  * Budget-exhausted payments are demoted straight to ``no_action`` rather
    than cascading down to the next-cheapest still-affordable channel.
  * The contact-frequency cap is tracked per customer within a single
    simulation pass over the in-scope batch (a customer with multiple
    failed payments in the batch can still only be contacted up to the cap
    across all of them), processed in descending-amount order so scarce
    contact slots go to the highest-value payments first.
  * Monte Carlo (n_simulation_runs) is used ONLY to report a sampling-
    variance range around net_value_created ("simulation uncertainty"),
    never as the headline number -- headline metrics are the exact
    analytic expectation, computed the same way evaluator.py computes them,
    which is possible only because the ground truth is synthetic and fully
    known.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd

from app.ev_engine import compute_ev_for_menu
from app.formatting import format_inr
from app.guardrails import apply_guardrails, full_menu
from app.models import (
    ALL_INTERVENTION_IDS,
    ESCALATE,
    INTERVENTION_UNIT_COSTS,
    NON_CONTACT_INTERVENTIONS,
    RecoveryLabPolicyMetrics,
    RecoveryLabSensitivityPoint,
)
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel

POLICY_LABELS: Dict[str, str] = {
    "no_intervention": "No intervention",
    "always_retry": "Always retry",
    "aggressive_recovery": "Aggressive recovery",
    "rve_adaptive": "RVE Adaptive",
}

# Which channels are "in play" for the Aggressive Recovery policy at each
# contact-intensity setting. This is what makes contact_intensity a genuine
# lever on that policy rather than a no-op control. Ordered highest-touch
# first; the policy
# picks the highest-COST channel in this list that also survives guardrails
# (deliberately NOT EV-optimal -- "aggressive" means highest-intensity
# available, which is the whole point of contrasting it with rve_adaptive).
CONTACT_INTENSITY_CHANNELS: Dict[str, List[str]] = {
    "low": ["email", "retry_later", "retry_now"],
    "moderate": ["whatsapp_nudge", "sms_link", "email", "retry_later", "retry_now"],
    "high": ["voice_call", "whatsapp_nudge", "sms_link", "retry_later", "retry_now"],
}

_ALL_POLICY_IDS = ["no_intervention", "always_retry", "aggressive_recovery", "rve_adaptive"]

# Safety cap on the Monte Carlo matrix size (n_payments * n_runs) so a large
# batch combined with a large run count can't hang the API -- per this
# project's stopping-rule requirement that no setting can make the UI hang
# indefinitely. When the
# requested run count would exceed this, it's reduced and the ACTUAL count
# used is reported back, never silently pretended.
_MAX_MONTE_CARLO_CELLS = 20_000_000
_MONTE_CARLO_CHUNK_CELLS = 2_000_000


@dataclass
class ScopedBatch:
    payments: pd.DataFrame
    hidden_truth_by_id: Dict[str, dict]
    customers_by_id: Dict[str, dict]


def scope_payments(
    batch_payments_df: pd.DataFrame, recovery_window_hours: int, now: Optional[datetime] = None
) -> pd.DataFrame:
    """Failed payments within the merchant's configured recovery window.

    ``failed_at`` values span up to the last 14 days relative to when the
    batch was generated (see simulator.py); a shorter window genuinely
    shrinks the in-scope population, which is what lets recovery_window_hours
    behave as a real dataset filter rather than a cosmetic control.
    """
    reference = now or datetime.utcnow()
    cutoff = reference - timedelta(hours=recovery_window_hours)
    scoped = batch_payments_df[batch_payments_df["failed_at"] >= cutoff]
    return scoped.reset_index(drop=True)


def compute_exposure(batch_payments_df: pd.DataFrame) -> Dict[str, float]:
    """Merchant-level exposure figures for the Recovery Lab header, computed
    directly from the current synthetic batch -- never hardcoded."""
    amounts = batch_payments_df["amount"]
    return {
        "total_at_risk": float(amounts.sum()),
        "n_failed_payments": int(len(batch_payments_df)),
        "median_payment_value": float(amounts.median()) if len(amounts) else 0.0,
    }


def _true_prob(base: float, uplift: Dict[str, float], intervention_id: str) -> float:
    return float(np.clip(base + uplift.get(intervention_id, 0.0), 0.0, 1.0))


def _select_aggressive(eligible_ids: List[str], intensity_channels: List[str]) -> str:
    """Highest-cost channel that is both intensity-permitted and guardrail-eligible."""
    candidates = [iid for iid in intensity_channels if iid in eligible_ids]
    if not candidates:
        return "no_action"
    return max(candidates, key=lambda iid: INTERVENTION_UNIT_COSTS[iid])


def _decide_row(
    policy: str,
    payment: dict,
    customer: dict,
    probs_by_intervention: Optional[Dict[str, float]],
    intensity_channels: List[str],
    suppression_list: Set[str],
    prior_contact_count: int,
    max_contacts_per_customer: int,
) -> Tuple[str, str, List[str], Dict[str, float]]:
    """Decide one payment's intervention under one policy.

    Returns (guardrail_choice, raw_ideal, eligible_ids, ev_by_intervention).
    ``raw_ideal`` ignores guardrails entirely (menu-wide ideal), so the
    caller can detect guardrail-driven demotion by comparing it to the
    guardrail-filtered choice.
    """
    menu = full_menu()
    eligible_ids, _ = apply_guardrails(
        menu,
        payment["amount"],
        payment["customer_id"],
        suppression_list,
        prior_contact_count=prior_contact_count,
        contact_cap=max_contacts_per_customer,
    )

    if policy == "no_intervention":
        return "no_action", "no_action", eligible_ids, {}

    if policy == "always_retry":
        return "retry_now", "retry_now", eligible_ids, {}

    if policy == "aggressive_recovery":
        raw_ideal = _select_aggressive(menu, intensity_channels)
        choice = _select_aggressive(eligible_ids, intensity_channels)
        return choice, raw_ideal, eligible_ids, {}

    if policy == "rve_adaptive":
        assert probs_by_intervention is not None
        ev_by_intervention = compute_ev_for_menu(probs_by_intervention, payment["amount"])
        raw_ideal = select_best_intervention(ev_by_intervention, menu)
        choice = select_best_intervention(ev_by_intervention, eligible_ids)
        return choice, raw_ideal, eligible_ids, ev_by_intervention

    raise ValueError(f"Unknown Recovery Lab policy: {policy}")


def _run_single_policy(
    policy: str,
    scoped_df: pd.DataFrame,
    hidden_truth_by_id: Dict[str, dict],
    customers_by_id: Dict[str, dict],
    model: ProbabilityModel,
    suppression_list: Set[str],
    contact_intensity: str,
    discount_budget: float,
    voice_capacity: int,
    max_contacts_per_customer: int,
    n_simulation_runs: int,
    seed: int,
) -> RecoveryLabPolicyMetrics:
    n = len(scoped_df)
    total_at_risk = float(scoped_df["amount"].sum())

    if n == 0:
        return RecoveryLabPolicyMetrics(
            policy_id=policy,
            policy_label=POLICY_LABELS[policy],
            n_payments_in_scope=0,
            total_at_risk=0.0,
            natural_recovery=0.0,
            gross_recovery=0.0,
            incremental_recovery=0.0,
            intervention_cost=0.0,
            net_value_created=0.0,
            recovery_rate=0.0,
            incremental_recovery_rate=0.0,
            number_intervened=0,
            number_contacted=0,
            number_blocked_by_guardrail=0,
            number_blocked_by_capacity=0,
            number_blocked=0,
            average_cost_per_recovery=0.0,
            allocation={},
            allocation_spend={},
        )

    intensity_channels = CONTACT_INTENSITY_CHANNELS[contact_intensity]

    # Precompute model probabilities for the WHOLE batch at once (vectorized)
    # rather than per-row, only when this policy actually needs the model.
    probs_matrix: Optional[Dict[str, np.ndarray]] = None
    spread_matrix: Optional[Dict[str, np.ndarray]] = None
    if policy == "rve_adaptive":
        customers_frame = pd.DataFrame(customers_by_id.values())
        probs_matrix = model.predict_proba_batch_matrix(scoped_df, customers_frame, full_menu())
        # Bootstrap-ensemble disagreement per intervention -- the confidence
        # gate below routes low-confidence rve_adaptive picks to escalation,
        # the same behaviour as the live /decide path. Only computed when the
        # model actually has an ensemble (fit(train_ensemble=True)); otherwise
        # this policy runs exactly as before.
        if model.spread_p95 is not None:
            spread_matrix = model.predict_spread_batch_matrix(scoped_df, customers_frame, full_menu())

    # Row-processing order determines who wins a scarce per-customer contact
    # slot when a customer has multiple in-scope payments -- for policies
    # with no EV concept (no_intervention/always_retry/aggressive_recovery),
    # raw amount is the only value signal available, so it's used directly.
    # For rve_adaptive, using amount here instead of EV was a real bug: a
    # customer's HIGH-amount-but-low-recovery-odds payment could consume the
    # contact slot ahead of a LOW-amount-but-high-recovery-odds sibling,
    # contradicting "EV-optimized per payment." Ranking by each row's best
    # achievable menu-wide EV (ignoring guardrails -- this is a priority
    # heuristic, not the guardrail-filtered decision itself) fixes that
    # while leaving the other three policies' behavior unchanged.
    if policy == "rve_adaptive" and probs_matrix is not None:
        amounts_for_priority = scoped_df["amount"].to_numpy(dtype=float)
        best_ev = np.full(n, -np.inf)
        for iid in full_menu():
            ev_for_intervention = probs_matrix[iid] * amounts_for_priority - INTERVENTION_UNIT_COSTS[iid]
            best_ev = np.maximum(best_ev, ev_for_intervention)
        order = best_ev.argsort()[::-1]
    else:
        order = scoped_df["amount"].to_numpy().argsort()[::-1]

    desired: List[str] = [""] * n
    eligible_lists: List[List[str]] = [[]] * n
    ev_lists: List[Dict[str, float]] = [{}] * n
    guardrail_blocked = np.zeros(n, dtype=bool)
    contact_counts: Dict[str, int] = {}

    for pos in order:
        payment = scoped_df.iloc[pos].to_dict()
        customer = customers_by_id[payment["customer_id"]]
        prior_count = contact_counts.get(payment["customer_id"], 0)
        probs_for_row = (
            {iid: float(probs_matrix[iid][pos]) for iid in full_menu()} if probs_matrix is not None else None
        )
        choice, raw_ideal, eligible_ids, ev_by_intervention = _decide_row(
            policy,
            payment,
            customer,
            probs_for_row,
            intensity_channels,
            suppression_list,
            prior_count,
            max_contacts_per_customer,
        )
        guardrail_blocked[pos] = choice != raw_ideal

        # Confidence gate (rve_adaptive only): after the guardrail-filtered
        # argmax, before the pick is recorded as executed. Escalation is not a
        # guardrail block and not a contact, so it is applied here -- after
        # guardrail_blocked is recorded and before the contact count is
        # incremented. Fires for any pick (including no_action) whose ensemble
        # spread is at/above the escalation threshold, matching /decide.
        if spread_matrix is not None and spread_matrix[choice][pos] >= model.spread_p95:
            choice = ESCALATE

        desired[pos] = choice
        eligible_lists[pos] = eligible_ids
        ev_lists[pos] = ev_by_intervention
        if choice != ESCALATE and choice not in NON_CONTACT_INTERVENTIONS:
            contact_counts[payment["customer_id"]] = prior_count + 1

    final = list(desired)
    capacity_blocked = np.zeros(n, dtype=bool)

    # --- Global resource constraint: voice capacity -----------------------
    voice_positions = [i for i in range(n) if final[i] == "voice_call"]
    if len(voice_positions) > voice_capacity:
        priority = sorted(
            voice_positions,
            key=lambda i: ev_lists[i].get("voice_call", scoped_df.iloc[i]["amount"]),
            reverse=True,
        )
        overflow = priority[voice_capacity:]
        for i in overflow:
            remaining = [iid for iid in eligible_lists[i] if iid != "voice_call"]
            if policy == "rve_adaptive" and remaining:
                final[i] = select_best_intervention(ev_lists[i], remaining)
            elif policy == "aggressive_recovery":
                final[i] = _select_aggressive(remaining, intensity_channels)
            else:
                final[i] = "no_action"
            capacity_blocked[i] = True

    # --- Global resource constraint: discount/spend budget -----------------
    # Escalated payments spend nothing and are excluded here.
    spend_positions = [i for i in range(n) if final[i] not in ("no_action", ESCALATE)]
    priority = sorted(
        spend_positions,
        key=lambda i: ev_lists[i].get(final[i], scoped_df.iloc[i]["amount"]),
        reverse=True,
    )
    running_spend = 0.0
    for i in priority:
        cost = INTERVENTION_UNIT_COSTS[final[i]]
        if running_spend + cost > discount_budget:
            final[i] = "no_action"
            capacity_blocked[i] = True
            continue
        running_spend += cost

    final_arr = np.array(final)
    # An escalated payment == the autonomous system took no action (a human
    # decides). Every economic figure below is computed from effective_arr,
    # which maps "escalate" -> "no_action"; final_arr is kept only for the
    # per-intervention allocation breakdown and number_escalated.
    escalated_mask = final_arr == ESCALATE
    number_escalated = int(escalated_mask.sum())
    effective_arr = np.where(escalated_mask, "no_action", final_arr)

    amounts = scoped_df["amount"].to_numpy(dtype=float)
    base_probs = np.array([hidden_truth_by_id[pid]["base_recovery_prob"] for pid in scoped_df["payment_id"]])
    uplifts = [hidden_truth_by_id[pid]["uplift_by_intervention"] for pid in scoped_df["payment_id"]]
    true_probs = np.array(
        [_true_prob(base_probs[i], uplifts[i], effective_arr[i]) for i in range(n)]
    )
    # The organic/"natural" baseline is the hidden truth's OWN no_action
    # outcome (base_recovery_prob + uplift_by_intervention["no_action"]),
    # not raw base_recovery_prob -- simulator.py's uplift generation adds
    # small noise to every intervention_id including "no_action" (its
    # base_uplift is 0.0, but noise can still nudge it either side), and
    # evaluator.py's own _true_expected_value treats "no_action" the same
    # way as every other intervention rather than special-casing it. Using
    # raw base_recovery_prob here instead would make gross_recovery !=
    # natural_recovery even under the no_intervention policy, which would
    # silently violate incremental_recovery == 0 for the do-nothing baseline.
    natural_probs = np.array(
        [_true_prob(base_probs[i], uplifts[i], "no_action") for i in range(n)]
    )
    costs = np.array([INTERVENTION_UNIT_COSTS[iid] for iid in effective_arr])

    # Per-intervention breakdown of the final assignment -- a pure read of
    # final_arr (which the headline metrics below are also computed from),
    # so this changes nothing about the decision. Keyed by every id so the
    # frontend never has to guess at a missing key; counts (including the
    # "escalate" key) sum to n.
    allocation = {iid: int(np.count_nonzero(final_arr == iid)) for iid in ALL_INTERVENTION_IDS}
    allocation[ESCALATE] = number_escalated
    allocation_spend = {
        iid: round(allocation[iid] * INTERVENTION_UNIT_COSTS[iid], 2) for iid in ALL_INTERVENTION_IDS
    }
    allocation_spend[ESCALATE] = 0.0

    natural_recovery = float(np.sum(natural_probs * amounts))
    gross_recovery = float(np.sum(true_probs * amounts))
    incremental_recovery = gross_recovery - natural_recovery
    intervention_cost = float(np.sum(costs))
    net_value_created = incremental_recovery - intervention_cost

    intervened_mask = effective_arr != "no_action"
    contacted_mask = ~np.isin(effective_arr, list(NON_CONTACT_INTERVENTIONS))
    expected_recoveries_from_intervention = float(np.sum(true_probs[intervened_mask]))
    average_cost_per_recovery = (
        intervention_cost / expected_recoveries_from_intervention
        if expected_recoveries_from_intervention > 0
        else 0.0
    )

    net_low: Optional[float] = None
    net_high: Optional[float] = None
    if n_simulation_runs > 0:
        net_low, net_high = _monte_carlo_net_value_range(
            true_probs, natural_probs, amounts, intervention_cost, n_simulation_runs, seed, policy
        )

    return RecoveryLabPolicyMetrics(
        policy_id=policy,
        policy_label=POLICY_LABELS[policy],
        n_payments_in_scope=n,
        total_at_risk=round(total_at_risk, 2),
        natural_recovery=round(natural_recovery, 2),
        gross_recovery=round(gross_recovery, 2),
        incremental_recovery=round(incremental_recovery, 2),
        intervention_cost=round(intervention_cost, 2),
        net_value_created=round(net_value_created, 2),
        recovery_rate=round(gross_recovery / total_at_risk, 4) if total_at_risk > 0 else 0.0,
        incremental_recovery_rate=round(incremental_recovery / total_at_risk, 4) if total_at_risk > 0 else 0.0,
        number_intervened=int(intervened_mask.sum()),
        number_contacted=int(contacted_mask.sum()),
        number_blocked_by_guardrail=int(guardrail_blocked.sum()),
        number_blocked_by_capacity=int(capacity_blocked.sum()),
        number_blocked=int((guardrail_blocked | capacity_blocked).sum()),
        number_escalated=number_escalated,
        average_cost_per_recovery=round(average_cost_per_recovery, 2),
        allocation=allocation,
        allocation_spend=allocation_spend,
        net_value_low=round(net_low, 2) if net_low is not None else None,
        net_value_high=round(net_high, 2) if net_high is not None else None,
    )


def _monte_carlo_net_value_range(
    true_probs: np.ndarray,
    natural_probs: np.ndarray,
    amounts: np.ndarray,
    intervention_cost: float,
    n_simulation_runs: int,
    seed: int,
    policy: str,
) -> Tuple[float, float]:
    """Seeded, vectorized, memory-chunked Monte Carlo resampling of actual
    (binary) recovery outcomes, used ONLY to report a sampling-variance
    range around net_value_created -- the headline metrics themselves are
    the exact analytic expectation (see module docstring). Deterministic
    for a given (seed, policy, config): the RNG is seeded from both so two
    different policies simulated in the same request don't share a draw
    stream, while the same policy simulated twice with the same seed and
    config reproduces the same range.
    """
    n = len(amounts)
    if n == 0:
        return 0.0, 0.0

    runs = min(n_simulation_runs, max(1, _MAX_MONTE_CARLO_CELLS // n))
    # NOT Python's builtin hash(): it's salted per-process (PYTHONHASHSEED
    # randomization, on by default since Python 3.3), so hash(policy) would
    # give a DIFFERENT Monte Carlo draw stream every time the backend
    # restarts, even for the identical (seed, policy, config) -- silently
    # breaking the "same seed reproduces the same result" guarantee across
    # process restarts (the one scenario where reproducibility actually
    # gets tested). zlib.crc32 is stable across processes and Python
    # versions, which is all this needs -- it's a policy-stream
    # differentiator, not a security-sensitive hash.
    policy_stream = zlib.crc32(policy.encode("utf-8"))
    rng = np.random.default_rng((seed, policy_stream))

    net_runs = np.empty(runs, dtype=float)
    chunk = max(1, min(runs, _MONTE_CARLO_CHUNK_CELLS // n))
    start = 0
    while start < runs:
        take = min(chunk, runs - start)
        treat_draws = rng.random((take, n)) < true_probs[None, :]
        natural_draws = rng.random((take, n)) < natural_probs[None, :]
        gross = (treat_draws * amounts[None, :]).sum(axis=1)
        natural = (natural_draws * amounts[None, :]).sum(axis=1)
        net_runs[start : start + take] = (gross - natural) - intervention_cost
        start += take

    low, high = np.percentile(net_runs, [2.5, 97.5])
    return float(low), float(high)


def _build_insight(policies: Dict[str, RecoveryLabPolicyMetrics], primary_policy_id: str) -> str:
    """Deterministic templated summary comparing the primary policy to the
    two credible baselines -- no LLM call, per this project's "no new LLM
    call" rule for this feature. Every number here is read straight off
    the already-computed metrics, never re-derived or hardcoded."""
    primary = policies[primary_policy_id]
    always_retry = policies["always_retry"]
    aggressive = policies["aggressive_recovery"]

    if primary_policy_id == "rve_adaptive":
        vs = always_retry
        net_pct, net_word = _pct_and_word(primary.net_value_created, vs.net_value_created)
        contact_pct, contact_word = _pct_and_word(
            primary.number_contacted, aggressive.number_contacted, more_word="more", less_word="fewer"
        )
        return (
            f"{primary.policy_label} creates {net_pct} {net_word} net value than Always Retry "
            f"({_inr(primary.net_value_created)} vs {_inr(vs.net_value_created)}) while contacting "
            f"{contact_pct} {contact_word} customers than Aggressive Recovery "
            f"({primary.number_contacted:,} vs {aggressive.number_contacted:,})."
        )

    if primary_policy_id == "aggressive_recovery":
        vs = policies["rve_adaptive"]
        gross_pct, gross_word = _pct_and_word(primary.gross_recovery, vs.gross_recovery)
        net_delta = vs.net_value_created - primary.net_value_created
        net_word = "more" if net_delta >= 0 else "less"
        return (
            f"{primary.policy_label} recovers {gross_pct} {gross_word} gross revenue than RVE Adaptive "
            f"({_inr(primary.gross_recovery)} vs {_inr(vs.gross_recovery)}), but RVE Adaptive creates "
            f"{_inr(abs(net_delta))} {net_word} net value once intervention cost is netted out "
            f"({_inr(vs.net_value_created)} vs {_inr(primary.net_value_created)})."
        )

    if primary_policy_id == "always_retry":
        vs = policies["no_intervention"]
        return (
            f"{primary.policy_label} recovers {_inr(primary.incremental_recovery)} more than doing "
            f"nothing at a cost of only {_inr(primary.intervention_cost)}, "
            f"{primary.net_value_created / primary.intervention_cost if primary.intervention_cost else 0:.1f}x "
            f"net value per rupee spent."
        )

    # no_intervention
    best_alt = max(
        (p for pid, p in policies.items() if pid != "no_intervention"), key=lambda p: p.net_value_created
    )
    return (
        f"{primary.policy_label} recovers only the organic baseline ({_inr(primary.natural_recovery)}). "
        f"{best_alt.policy_label} would add {_inr(best_alt.net_value_created)} in net value on this batch."
    )


def _pct_and_word(a: float, b: float, more_word: str = "more", less_word: str = "less") -> Tuple[str, str]:
    """Percentage magnitude of (a vs b) plus the correct direction word, so
    a templated insight sentence stays factually correct regardless of
    which way a given simulation's numbers actually land -- this project's
    stated design intent is explicit that a policy comparison must never be
    forced to read a particular way."""
    word = more_word if a >= b else less_word
    if b == 0:
        return "N/A", word
    pct = abs((a - b) / abs(b)) * 100
    return f"{pct:.1f}%", word


def _inr(amount: float) -> str:
    return format_inr(amount)


def run_recovery_lab_simulation(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    model: ProbabilityModel,
    suppression_list: Set[str],
    primary_policy_id: str,
    contact_intensity: str,
    discount_budget: float,
    voice_capacity: int,
    max_contacts_per_customer: int,
    recovery_window_hours: int,
    n_simulation_runs: int,
    seed: int,
) -> Tuple[Dict[str, RecoveryLabPolicyMetrics], int, float, Optional[str]]:
    """Simulate all four policies (always all four, per this project's rule
    -- "never force RVE to win, if another policy wins, show it") under the
    SAME scope and resource constraints, so the comparison is apples-to-
    apples. Returns (policies_by_id, n_payments_in_scope, total_at_risk,
    example_payment_id).
    """
    scoped_df = scope_payments(batch_payments_df, recovery_window_hours)
    hidden_truth_by_id = hidden_truth_df.set_index("payment_id").to_dict(orient="index")
    customers_by_id = customers_df.set_index("customer_id").to_dict(orient="index")
    for cid, row in customers_by_id.items():
        row["customer_id"] = cid

    n_in_scope = len(scoped_df)
    total_at_risk = float(scoped_df["amount"].sum()) if n_in_scope else 0.0

    policies: Dict[str, RecoveryLabPolicyMetrics] = {}
    for policy_id in _ALL_POLICY_IDS:
        policies[policy_id] = _run_single_policy(
            policy_id,
            scoped_df,
            hidden_truth_by_id,
            customers_by_id,
            model,
            suppression_list,
            contact_intensity,
            discount_budget,
            voice_capacity,
            max_contacts_per_customer,
            n_simulation_runs,
            seed,
        )

    example_payment_id: Optional[str] = None
    if n_in_scope:
        example_payment_id = str(scoped_df.iloc[int(scoped_df["amount"].to_numpy().argmax())]["payment_id"])

    return policies, n_in_scope, total_at_risk, example_payment_id


def build_insight(policies: Dict[str, RecoveryLabPolicyMetrics], primary_policy_id: str) -> str:
    return _build_insight(policies, primary_policy_id)


def default_sensitivity_levels(dimension: str, scope_size: int) -> List[float]:
    if dimension == "voice_capacity":
        raw = [0, 250, 500, 1000, 1500, 2000, 3000, 5000]
        return [float(v) for v in raw if v <= max(scope_size, 500)]
    if dimension == "discount_budget":
        return [0.0, 5_000.0, 10_000.0, 25_000.0, 50_000.0, 100_000.0]
    if dimension == "max_contacts_per_customer":
        return [1.0, 2.0, 3.0]
    raise ValueError(f"Unknown sensitivity dimension: {dimension}")


def run_sensitivity_sweep(
    batch_payments_df: pd.DataFrame,
    customers_df: pd.DataFrame,
    hidden_truth_df: pd.DataFrame,
    model: ProbabilityModel,
    suppression_list: Set[str],
    policy_id: str,
    dimension: str,
    contact_intensity: str,
    discount_budget: float,
    voice_capacity: int,
    max_contacts_per_customer: int,
    recovery_window_hours: int,
    seed: int,
    levels: Optional[List[float]] = None,
) -> Tuple[List[RecoveryLabSensitivityPoint], float, float]:
    """Sweep one resource dimension across a set of levels, re-running the
    full simulation at each level (Monte Carlo skipped for the sweep itself
    -- n_simulation_runs=0 -- since only the headline analytic numbers are
    needed per point, and re-running Monte Carlo at every level would be
    wasted computation for a curve, not a single decision).

    The "optimal operating point" is whichever swept level produced the
    highest net_value_created -- computed from the actual simulation
    results, never hardcoded.
    """
    scoped_df = scope_payments(batch_payments_df, recovery_window_hours)
    levels = levels or default_sensitivity_levels(dimension, len(scoped_df))

    points: List[RecoveryLabSensitivityPoint] = []
    for level in levels:
        kwargs = dict(
            contact_intensity=contact_intensity,
            discount_budget=discount_budget,
            voice_capacity=voice_capacity,
            max_contacts_per_customer=max_contacts_per_customer,
        )
        if dimension == "voice_capacity":
            kwargs["voice_capacity"] = int(level)
        elif dimension == "discount_budget":
            kwargs["discount_budget"] = float(level)
        elif dimension == "max_contacts_per_customer":
            kwargs["max_contacts_per_customer"] = int(level)
        else:
            raise ValueError(f"Unknown sensitivity dimension: {dimension}")

        metrics = _run_single_policy(
            policy_id,
            scoped_df,
            hidden_truth_df.set_index("payment_id").to_dict(orient="index"),
            {cid: {**row, "customer_id": cid} for cid, row in customers_df.set_index("customer_id").to_dict(orient="index").items()},
            model,
            suppression_list,
            kwargs["contact_intensity"],
            kwargs["discount_budget"],
            kwargs["voice_capacity"],
            kwargs["max_contacts_per_customer"],
            n_simulation_runs=0,
            seed=seed,
        )
        points.append(
            RecoveryLabSensitivityPoint(
                level=float(level),
                incremental_recovery=metrics.incremental_recovery,
                intervention_cost=metrics.intervention_cost,
                net_value_created=metrics.net_value_created,
            )
        )

    best = max(points, key=lambda p: p.net_value_created)
    return points, best.level, best.net_value_created
