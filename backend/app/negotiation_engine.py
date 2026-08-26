"""Recovery Negotiation Engine -- "how much incentive is enough," not "which
intervention." See docs/RECOVERY_NEGOTIATION_ENGINE.md for the full spec;
this module implements it.

Product framing: the rest of this repo (RVE) decides ONE thing per failed
payment -- which intervention to take (no_action, sms_link, voice_call, ...)
-- by argmax EV over a fixed menu (see ev_engine.py, optimizer.py,
guardrails.py). This module takes RVE's chosen intervention AS GIVEN and asks
a different question: for interventions that can carry a variable incentive
attached, how large should that incentive be? A larger incentive almost
always recovers more payments; it does not follow that it creates more
value. This module searches a ladder of incentive levels and finds the
MINIMUM EFFECTIVE INTERVENTION -- the cheapest level that still captures
(within a configurable tolerance) the maximum expected net value achievable
on that ladder. It never chooses WHICH intervention -- that decision stays
entirely with RVE.

Hard boundary (non-negotiable): this module is OFFLINE and analysis-only.
It never imports razorpay_client, never sends a real message, and never
mutates real payment or audit state -- see main.py's route for the read-only
architectural boundary this module operates inside.

Reuses rather than duplicates:
  * app.probability_model.ProbabilityModel.predict_proba_for_intervention --
    the REAL trained model, for the Rs.0-incentive baseline probability only.
  * app.guardrails.apply_guardrails -- base-intervention eligibility
    (suppression list, voice-call amount threshold, contact-frequency cap).
  * app.ev_engine.compute_ev -- the base intervention's own EV, and the same
    `probability * amount - unit_cost` convention this module's own EV
    formula extends.
  * app.models.INTERVENTION_UNIT_COSTS -- the base intervention's fixed
    execution cost, added into every candidate's EV.

The ONE new piece of modeling in this module is the incentive-response
curve below (`incentive_response_probability`). The trained ProbabilityModel
has a fixed, closed vocabulary for `assigned_intervention` -- it cannot take
a continuous incentive amount as a feature without retraining, and this
project's own ground rules forbid introducing a second ML model for this.
The curve is therefore a documented, deterministic, closed-form extension on
top of the real model's baseline prediction -- NOT a new model, and NOT
learned or measured customer behavior. `max_uplift`/`half_saturation` below
are hand-picked, explicitly synthetic assumptions (see docs Section 6) --
never describe them as real elasticities in any code comment, log message,
or UI copy that reads this module's output.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

from app.ev_engine import compute_ev
from app.guardrails import apply_guardrails
from app.models import INTERVENTION_UNIT_COSTS, NegotiationAnalyzeResponse, NegotiationCandidateModel
from app.probability_model import ProbabilityModel


MAX_CANDIDATES = 200


def generate_incentive_ladder(min_incentive: float, max_incentive: float, step: float) -> List[float]:
    """Generate ``[min_incentive, min_incentive + step, ..., max_incentive]``
    (inclusive of both ends when evenly divisible). Bounded so a malformed
    request can't generate hundreds of thousands of candidates (docs
    Section 7) -- raises ValueError rather than silently truncating.
    """
    if min_incentive < 0:
        raise ValueError("min_incentive must be >= 0.")
    if max_incentive < min_incentive:
        raise ValueError("max_incentive must be >= min_incentive.")
    if step <= 0:
        raise ValueError("step must be > 0.")

    n = int((max_incentive - min_incentive) / step + 1e-9) + 1
    if n > MAX_CANDIDATES:
        raise ValueError(f"Requested ladder has {n} levels, exceeding the maximum of {MAX_CANDIDATES}.")
    return [round(min_incentive + i * step, 2) for i in range(n)]


@dataclass(frozen=True)
class IncentiveResponseParams:
    max_uplift: float
    half_saturation: float


# Hand-picked, EXPLICITLY SYNTHETIC assumptions (docs Section 6) -- not
# fitted to real payment or discount-response data, because none exists for
# this project. Different failure reasons get different ceilings/saturation
# points to reflect the domain intuition already documented in this repo
# (CLAUDE.md Section 4: different failure reasons imply different things
# about customer intent) -- NOT a claim of measured price elasticity.
INCENTIVE_RESPONSE_PARAMS: Dict[str, IncentiveResponseParams] = {
    "insufficient_funds": IncentiveResponseParams(max_uplift=0.35, half_saturation=80.0),
    "other": IncentiveResponseParams(max_uplift=0.15, half_saturation=150.0),
    "bank_timeout": IncentiveResponseParams(max_uplift=0.05, half_saturation=300.0),
    "network_error": IncentiveResponseParams(max_uplift=0.05, half_saturation=300.0),
    "card_expired": IncentiveResponseParams(max_uplift=0.03, half_saturation=400.0),
    # Never incentive-responsive at all -- see the fraud_block guardrail in
    # determine_candidate_eligibility, which blocks every c > 0 for this
    # failure reason before this function would ever be called with one.
    "fraud_block": IncentiveResponseParams(max_uplift=0.0, half_saturation=1.0),
}


def incentive_response_probability(base_probability: float, failure_reason: str, incentive: float) -> float:
    """P(recovery | c) = clip(base + max_uplift * c / (c + half_saturation), 0, 1).

    A Hill/saturation curve: uplift grows with `incentive` but with strictly
    diminishing returns, approaching (never exceeding) `max_uplift` as
    `incentive -> infinity`. Deterministic (no randomness), bounded to
    [0, 1] by construction, reproducible for identical inputs.
    """
    if incentive <= 0:
        return max(0.0, min(1.0, base_probability))
    params = INCENTIVE_RESPONSE_PARAMS[failure_reason]
    uplift = params.max_uplift * incentive / (incentive + params.half_saturation)
    return max(0.0, min(1.0, base_probability + uplift))


@dataclass(frozen=True)
class GuardrailPolicy:
    """Minimal in-memory merchant policy layer (docs Section 28) -- no
    persistent per-merchant config store exists elsewhere in this stateless
    demo app, so a single default is the appropriate minimal addition."""

    max_incentive: float = 500.0


DEFAULT_GUARDRAIL_POLICY = GuardrailPolicy()


def determine_candidate_eligibility(
    levels: List[float],
    base_intervention_id: str,
    base_eligible: bool,
    base_blocked_reason: Optional[str],
    failure_reason: str,
    policy: GuardrailPolicy,
) -> Dict[float, Optional[str]]:
    """Decide eligibility for every candidate level FIRST, before any
    economic computation runs for it (docs Section 8 / CLAUDE.md Section 27).
    Returns {incentive: blocked_reason_or_None}.
    """
    reasons: Dict[float, Optional[str]] = {}
    for c in levels:
        if not base_eligible:
            reasons[c] = base_blocked_reason or f"Blocked: {base_intervention_id} is not eligible for this payment."
            continue
        if failure_reason == "fraud_block" and c > 0:
            reasons[c] = "Blocked: incentives are never offered on a fraud-flagged payment."
            continue
        if c > policy.max_incentive:
            reasons[c] = f"Blocked: merchant policy does not allow this incentive (maximum Rs.{policy.max_incentive:,.0f})."
            continue
        reasons[c] = None
    return reasons


def compute_candidates(
    levels: List[float],
    blocked_reasons: Dict[float, Optional[str]],
    base_probability: float,
    failure_reason: str,
    amount: float,
    intervention_unit_cost: float,
) -> List[NegotiationCandidateModel]:
    """One candidate per ladder level. Eligibility is looked up (never
    recomputed here) BEFORE any arithmetic runs -- a blocked level is
    returned with every economic field left null, never computed then
    discarded (docs Section 8 / CLAUDE.md Section 27)."""
    candidates: List[NegotiationCandidateModel] = []
    for c in levels:
        reason = blocked_reasons[c]
        if reason is not None:
            candidates.append(NegotiationCandidateModel(incentive=c, eligible=False, blocked_reason=reason))
            continue

        p = incentive_response_probability(base_probability, failure_reason, c)
        gross = p * amount
        net = gross - c - intervention_unit_cost
        incremental = (p - base_probability) * amount
        candidates.append(
            NegotiationCandidateModel(
                incentive=c,
                eligible=True,
                blocked_reason=None,
                recovery_probability=round(p, 4),
                incremental_recovery=round(incremental, 2),
                incentive_cost=c,
                intervention_cost=intervention_unit_cost,
                expected_gross_recovery=round(gross, 2),
                expected_net_value=round(net, 2),
            )
        )
    return candidates


def select_outcomes(
    candidates: List[NegotiationCandidateModel], tolerance: float
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Three DISTINCT outcomes over the eligible candidate set (docs
    Section 9) -- never merged into one field, never forced to coincide.
    Returns (max_recovery_probability_candidate, optimum_candidate,
    minimum_effective_intervention); all three None if nothing is eligible.
    """
    eligible = [c for c in candidates if c.eligible]
    if not eligible:
        return None, None, None

    max_prob_candidate = max(eligible, key=lambda c: c.recovery_probability).incentive
    optimum_c = max(eligible, key=lambda c: c.expected_net_value)
    threshold = tolerance * optimum_c.expected_net_value
    mei_c = min((c for c in eligible if c.expected_net_value >= threshold), key=lambda c: c.incentive)
    return max_prob_candidate, optimum_c.incentive, mei_c.incentive


def compute_margin_protected(
    candidates: List[NegotiationCandidateModel], minimum_effective_intervention: Optional[float]
) -> Optional[float]:
    """Net-value difference between the recommendation and the next-more-
    aggressive eligible tier (docs Section 10). None whenever there is no
    next tier, or the next tier would have had equal-or-higher value --
    "only when well-defined," never fabricated.
    """
    if minimum_effective_intervention is None:
        return None
    eligible = sorted((c for c in candidates if c.eligible), key=lambda c: c.incentive)
    idx = next((i for i, c in enumerate(eligible) if c.incentive == minimum_effective_intervention), None)
    if idx is None or idx + 1 >= len(eligible):
        return None
    diff = eligible[idx].expected_net_value - eligible[idx + 1].expected_net_value
    if diff < 0:
        return None
    return round(diff, 2)


def build_explanation(
    candidates: List[NegotiationCandidateModel],
    optimum: Optional[float],
    minimum_effective_intervention: Optional[float],
    tolerance: float,
    policy: GuardrailPolicy,
) -> str:
    """Deterministic template, built entirely from the numbers already
    computed above -- no LLM call anywhere in this module (docs Section 16).
    Never calls minimum_effective_intervention "the optimal intervention."
    """
    if optimum is None or minimum_effective_intervention is None:
        blocked = next((c.blocked_reason for c in candidates if not c.eligible and c.blocked_reason), None)
        return "No incentive level is eligible for this payment" + (f": {blocked}" if blocked else ".")

    by_incentive = {c.incentive: c for c in candidates}
    optimum_c = by_incentive[optimum]

    if minimum_effective_intervention == 0.0:
        sentence = (
            "No incentive is recommended: at this payment's failure reason, additional "
            "incentive does not generate enough incremental recovery to offset its cost."
        )
    else:
        mei_c = by_incentive[minimum_effective_intervention]
        eligible_sorted = sorted((c for c in candidates if c.eligible), key=lambda c: c.incentive)
        idx = next(i for i, c in enumerate(eligible_sorted) if c.incentive == minimum_effective_intervention)
        tradeoff = ""
        if idx + 1 < len(eligible_sorted):
            nxt = eligible_sorted[idx + 1]
            delta_pp = (nxt.recovery_probability - mei_c.recovery_probability) * 100
            delta_cost = nxt.incentive_cost - mei_c.incentive_cost
            delta_ev = mei_c.expected_net_value - nxt.expected_net_value
            if delta_ev > 0:
                tradeoff = (
                    f" Rs.{nxt.incentive:,.0f} increases recovery probability by {delta_pp:.1f} "
                    f"percentage points, but its additional Rs.{delta_cost:,.0f} cost reduces "
                    f"expected net value by Rs.{delta_ev:,.0f}."
                )
        sentence = (
            f"Rs.{minimum_effective_intervention:,.0f} is recommended because it achieves "
            f"{tolerance:.0%} of the maximum expected net value (Rs.{optimum_c.expected_net_value:,.0f}) "
            f"at the lowest incentive cost."
        ) + tradeoff

    blocked_above_ceiling = [
        c for c in candidates if not c.eligible and c.blocked_reason and "merchant policy" in c.blocked_reason
    ]
    if blocked_above_ceiling:
        top = max(blocked_above_ceiling, key=lambda c: c.incentive)
        sentence += (
            f" Rs.{top.incentive:,.0f} is blocked by merchant policy "
            f"(maximum incentive: Rs.{policy.max_incentive:,.0f})."
        )

    return sentence


def analyze_negotiation(
    payment: Dict,
    customer: Dict,
    base_intervention_id: str,
    model: ProbabilityModel,
    suppression_list: Set[str],
    prior_contact_count: int,
    min_incentive: float = 0.0,
    max_incentive: float = 500.0,
    step: float = 50.0,
    optimization_tolerance: float = 0.95,
    policy: Optional[GuardrailPolicy] = None,
) -> NegotiationAnalyzeResponse:
    """Orchestrates the full pipeline for one payment: base probability from
    the REAL trained model, guardrails BEFORE economics, candidate curve,
    three distinct outcomes, margin protected, deterministic explanation.

    ``base_intervention_id`` is always the intervention RVE already chose
    for this payment (see main.py's route) -- this function never chooses
    WHICH intervention, only evaluates incentive levels on top of it.
    """
    if policy is None:
        policy = DEFAULT_GUARDRAIL_POLICY
    if not (0.0 < optimization_tolerance <= 1.0):
        raise ValueError("optimization_tolerance must be in (0, 1].")

    amount = float(payment["amount"])
    failure_reason = str(payment["failure_reason"])

    base_probability = model.predict_proba_for_intervention(payment, customer, base_intervention_id)
    base_expected_value = compute_ev(base_probability, amount, base_intervention_id)

    base_eligible_ids, base_blocked = apply_guardrails(
        [base_intervention_id],
        amount,
        payment["customer_id"],
        suppression_list,
        prior_contact_count=prior_contact_count,
    )
    base_eligible = base_intervention_id in base_eligible_ids
    base_blocked_reason = base_blocked.get(base_intervention_id)

    levels = generate_incentive_ladder(min_incentive, max_incentive, step)
    blocked_reasons = determine_candidate_eligibility(
        levels, base_intervention_id, base_eligible, base_blocked_reason, failure_reason, policy,
    )
    candidates = compute_candidates(
        levels, blocked_reasons, base_probability, failure_reason, amount,
        INTERVENTION_UNIT_COSTS[base_intervention_id],
    )

    max_prob, optimum, mei = select_outcomes(candidates, optimization_tolerance)
    margin_protected = compute_margin_protected(candidates, mei)
    explanation = build_explanation(candidates, optimum, mei, optimization_tolerance, policy)

    return NegotiationAnalyzeResponse(
        payment_id=str(payment["payment_id"]),
        amount=amount,
        failure_reason=failure_reason,
        customer_id=str(payment["customer_id"]),
        base_intervention=base_intervention_id,
        base_probability=round(base_probability, 4),
        base_expected_value=round(base_expected_value, 2),
        candidates=candidates,
        max_recovery_probability_candidate=max_prob,
        optimum_candidate=optimum,
        minimum_effective_intervention=mei,
        optimization_tolerance=optimization_tolerance,
        margin_protected=margin_protected,
        explanation=explanation,
    )
